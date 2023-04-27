import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecrAsset from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import * as batch from '@aws-cdk/aws-batch-alpha';
import * as fs from 'fs';
import { merge as deepMerge } from 'lodash';


/**
 * Used to allow optional override of the default container options defined by 
 * BatchWorkflowStep.createJobDefinition() while preventing override of values
 * that would likely cause errors if overridden. 
 */
type EcsEc2ContainerDefinitionOptionOverrides = Omit<batch.EcsEc2ContainerDefinitionProps, 'image' | 'jobRole' | 'logging' | 'cpu' | 'memory'> & {
    // make these optional when creating a class instance, since class method createJobDefinition already defines defaults
    cpu?: number,
    memory?: number
};


interface BatchWorkflowStepProps {
    /**
     * Logical name of the workflow this workflow step belongs to.
     * Value will be added as environment variable to job container.
     */
    workflowName: string;
    /**
     * Logical name of the workflow step that describes it's purpose.
     * Value will be added as environment variable to job container.
     */
    workflowStepName: string;
    /** AWS Batch EC2 compute environment where job container will run. */
    computeEnvironment: batch.ManagedEc2EcsComputeEnvironment;
    containerImage: ecs.ContainerImage;
    /** Property overrides for the job container that will be merged into
     * defaults provided by the construct. Examples include adding 
     * environment variables, choosing non-default instance types, requesting
     * a GPU instance, or modifying memory or CPU. 
     */
    containerDefinitionOptions?: EcsEc2ContainerDefinitionOptionOverrides, //batch.EcsEc2ContainerDefinitionProps;
    /**
     * Priority of this workflow step's job queue relative to the job queues
     * of other steps in the same workflow. Higher-priority queues
     * will take precedence over lower numbers, with default being a value of 1. 
     * 
     * As an example, if the first job  is responsible for scheduling downstream
     * jobs in a workflow, consider providing a higher priority to the job because
     * it's important that all required jobs are added to queues as quickly as 
     * possible. This ensures that one AWS Batch performs its next capacity needs
     * assessment, it has as much of an accurate view as possible into demand.
     * 
     * @type {number} a value from 1 to 10
     */
    queuePriority?: number;
    jobTable: dynamodb.Table;
    jobBucket: s3.Bucket;
}

/**
 * Create a batch workflow step, which creates an AWS Batch job definition with it's own
 * dedicated queue and IAM role associated to a pre-existing AWS Batch EC2 compute environment.
 *
 * @export
 * @class BatchWorkflowStep
 * @extends {Construct}
 */
export class BatchWorkflowStep extends Construct {
    readonly workflowName: string;
    readonly workflowStepName: string;
    readonly jobTable: dynamodb.Table;
    readonly jobBucket: s3.Bucket;
    readonly jobQueue: batch.JobQueue;
    readonly jobRole: iam.Role;
    readonly jobDefinition: batch.EcsJobDefinition;
    readonly ecsContainerImage: ecs.ContainerImage;
    readonly queuePriority?: number;
    readonly computeEnvironment: batch.ManagedEc2EcsComputeEnvironment;

    constructor(scope: Construct, id: string, props: BatchWorkflowStepProps) {
        super(scope, id);
        this.workflowName = props.workflowName; 
        this.workflowStepName = props.workflowStepName;
        this.ecsContainerImage = props.containerImage;
        this.jobTable = props.jobTable;
        this.jobBucket = props.jobBucket;
        this.jobRole = this.createJobRole();
        this.computeEnvironment = props.computeEnvironment;
        this.jobDefinition = this.createJobDefinition(props.containerDefinitionOptions);
        this.jobQueue = this.createJobQueue(props.queuePriority);
    }
    
    
    private createJobRole(): iam.Role {
        const role = new iam.Role(this, 'JobTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        });
        role.addToPolicy(
            new iam.PolicyStatement({
                sid:"DescribeAllJobs",
                effect: iam.Effect.ALLOW,
                actions: [
                    'batch:DescribeJobs',
                ],
                resources: ['*']
            })
        );
        return role;
    }

    
    // Give permission to invoke this workflow step's jobDefintion for this specific queue
    public grantSubmitJob(policySidSuffix: string, grantee: iam.IGrantable): void {
        grantee.grantPrincipal.addToPrincipalPolicy(
            new iam.PolicyStatement({
                sid:"SubmitJob" + policySidSuffix,
                effect: iam.Effect.ALLOW,
                actions: [
                    'batch:SubmitJob',
                ],
                resources: [
                    this.jobQueue.jobQueueArn,
                    this.jobDefinition.jobDefinitionArn
                ]
            })
        );
    }


    // Defines compute resources and container options for the job
    private createJobDefinition(batchContainerDefinitionOverrides?: EcsEc2ContainerDefinitionOptionOverrides): batch.EcsJobDefinition {
        const defaultContainerOptions: batch.EcsEc2ContainerDefinitionProps = {
            image: this.ecsContainerImage,

            jobRole: this.jobRole,
            logging: ecs.AwsLogDriver.awsLogs({
                streamPrefix: this.workflowStepName,
                logRetention: 30,
                mode: ecs.AwsLogDriverMode.NON_BLOCKING,
            }),
            memory: cdk.Size.mebibytes(1000),
            cpu: 1,
            gpu: 0,
            environment: {
                AWS_REGION: cdk.Stack.of(this).region,
                WORKFLOW: this.workflowName,
                WORKFLOW_STEP: this.workflowStepName,
                JOB_TABLE: this.jobTable.tableName,
                JOB_BUCKET: this.jobBucket.bucketName,
            },
        };

        // deep merge avoids unexpected overwrite of nested defaults 
        const mergedContainerOptions: batch.EcsEc2ContainerDefinitionProps = deepMerge(
            defaultContainerOptions,
            batchContainerDefinitionOverrides
        );

        return new batch.EcsJobDefinition(this, `jobDefinition`, {
            retryAttempts: 3,
            propagateTags: true,
            container: new batch.EcsEc2ContainerDefinition(this, `EcsEc2ContainerDefinition`, mergedContainerOptions),
        });
    }


    private createJobQueue(queuePriority?: number): batch.JobQueue {
        return new batch.JobQueue(this, `JobQueue`, {
          priority: queuePriority,
          enabled: true,
          computeEnvironments: [
            {
              computeEnvironment: this.computeEnvironment, 
              order: 1
            }
          ]
        });
      }
}


function removeNonAlphanumeric(str: string): string {
    return str.replace(/[^a-zA-Z0-9]/g, '');
}

function capitalize(inputStr:string) {
    const firstLetter = inputStr.charAt(0);
    const remainingLetters = inputStr.substring(1);
    return firstLetter.toUpperCase() + remainingLetters;
}