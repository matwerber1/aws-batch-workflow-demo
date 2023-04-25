import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecrAsset from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import * as batch from '@aws-cdk/aws-batch-alpha';
import * as fs from 'fs';


export class AwsBatchParallelJobsCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = this.createVpc();
    
    this.createVpcEndpoints(vpc);
    
    const ecrContainerImage = this.createDockerImageAsset('images/demo');
    const jobTaskRole = this.createJobTaskRole();
    const jobDefinition = this.createJobDefinition(ecrContainerImage, jobTaskRole);
    const createEc2LaunchTemplate = this.createEc2LaunchTemplate();
    const computeEnvironment = this.createComputeEnvironment(vpc)
    const jobQueue = this.createJobQueue(computeEnvironment);
    this.grantSubmitBatchJobToRole(jobQueue, jobDefinition, jobTaskRole);

    this.addCloudFormationOutputs({
      BatchVpc: vpc.vpcId,
      BatchComputeEnvironment: computeEnvironment.computeEnvironmentName,
      BatchJobQueue: jobQueue.jobQueueName,
      BatchTaskImage: ecrContainerImage.imageUri,
      BatchTaskRole: jobTaskRole.roleArn,
      BatchJobDefinition: jobDefinition.jobDefinitionName
    });
  }
  private createVpc(): ec2.Vpc {
    // This construct is a shorthand construct for creating a new VPC, subnets, 
    // route tables, and if you specify PUBLIC or PRIVATE_WITH_EGRESS subnets, 
    // a properly-configured Internet Gateway (IGW) and NAT Gateway (NGW), respectively: 
    return new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,                         // In prod, consider using all available AZs so as to maximize the EC2 capacity pools you may draw from
      natGateways: 1,                    // While 1 NGW may be shared by subnets across AZs, in prod, it's recommended to have one per AZ for high availability
      subnetConfiguration: [
        {
          name: 'public-subnet',
          subnetType: ec2.SubnetType.PUBLIC     // in this demo, public subnets only contain our NGW(s) so that resources in private subnets have an egress path to the internet
        },
        {
          name: 'private-subnet',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS  // this is where we will launch our batch compute EC2 instances
        }
      ],
    });
  }

  private createEc2LaunchTemplate(): ec2.CfnLaunchTemplate {
    const userdata = fs.readFileSync('./lib/bin/')
    return new ec2.CfnLaunchTemplate(this, 'Ec2LaunchTemplate', {
      launchTemplateData: {
        userData: cdk.Fn.base64(user_data),
      },
    });
  }


  /**
   * Creates an AWS Batch managed compute environment to run batch jobs on Amazon ECS via an EC2 auto-scaling group.
   *
   * @private
   * @param {ec2.Vpc} vpc
   * @return {*}  {batch.ManagedEc2EcsComputeEnvironment}
   * @memberof AwsBatchParallelJobsCdkStack
   */
  private createComputeEnvironment(vpc: ec2.Vpc): batch.ManagedEc2EcsComputeEnvironment {
    const computeEnvironment = new batch.ManagedEc2EcsComputeEnvironment(this, 'Ec2BatchEnvironment', {
      enabled: true,
      replaceComputeEnvironment: true, // do **not** change this value if you are changing any other properties in the same stack update: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-batch-computeenvironment.html#cfn-batch-computeenvironment-replacecomputeenvironment
      terminateOnUpdate: true,         // in prod, may want to set to false and add a timeout before termination with updateTimeout parameter
      vpc: vpc,
      vpcSubnets: { 
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS 
      },
      /*
      images: [
        {
          // used for jobs that do not require GPU
          imageType: batch.EcsMachineImageType.ECS_AL2,
        },
        {
          // Required if job will use GPUs
          imageType: batch.EcsMachineImageType.ECS_AL2_NVIDIA,
        }
        
      ],
      */
      spot: true,
      allocationStrategy: batch.AllocationStrategy.BEST_FIT_PROGRESSIVE,
      maxvCpus: 20,
      minvCpus: 0,
      useOptimalInstanceClasses: true, 
      instanceClasses: [
        ec2.InstanceClass.M5
      ],
    });

    // Required minimum permissions: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/instance_IAM_role.html
    computeEnvironment.instanceRole?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role')
    );
    
    return computeEnvironment;
  }

  /**
   * Create job queue and attach it to an AWS Batch compute environment. 
   *
   * @private
   * @param {batch.ManagedEc2EcsComputeEnvironment} computeEnvironment
   * @return {*}  {batch.JobQueue}
   * @memberof AwsBatchParallelJobsCdkStack
   */
  private createJobQueue(computeEnvironment: batch.ManagedEc2EcsComputeEnvironment): batch.JobQueue {
    return new batch.JobQueue(this, 'TaskJobQueue', {
      priority: 1,
      enabled: true,
      computeEnvironments: [
        {
          computeEnvironment: computeEnvironment, 
          order: 1
        }
      ]
    });
  }

  /**
   * Create a DynamoDB table that upstream applications can use to provide additional runtime
   * information to jobs, and that jobs can use to pass information to downstream jobs and other
   * consumers. 
   *
   * @private
   * @return {*}  {dynamodb.Table}
   * @memberof AwsBatchParallelJobsCdkStack
   */
  private createMetadataTable(): dynamodb.Table {
    return new dynamodb.Table(this, 'JobTable', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,           // for a demo, its ok to remove table if stack is deleted
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,  // for a demo with low usage, easy and cost-effective. For high-volume reads & writes, provisioned can be much more cost effective
      partitionKey: {
        name: 'partitionKey',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'sortKey', 
        type: dynamodb.AttributeType.STRING
      }    
    });
  }

  /**
   * Create IAM role assumable by an ECS container task and has 
   * the required AWS-managed policy "AmazonECSTaskExecutionRolePolicy".
   * @private
   * @return {*}  {iam.Role}
   * @memberof AwsBatchParallelJobsCdkStack
   */
  private createJobTaskRole(): iam.Role {
    return new iam.Role(this, 'JobTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });
  }

  /**
   * Locally build a Dockerfile and push image to an ECR repository in your account managed by CDK. 
   * @param directoryRelativePath Path relative to the 'lib/' directory of this project, that contains your Dockerfile
   * @returns 
   */
  private createDockerImageAsset(directoryRelativePath: string): ecrAsset.DockerImageAsset {
    return new ecrAsset.DockerImageAsset(this, 'ecrImage', {
      directory: path.join(__dirname, 'images/demo/'),
    }); 
  }

  private createJobDefinition(image: ecrAsset.DockerImageAsset, taskRole: iam.Role): batch.EcsJobDefinition {
    
    const logConfig = ecs.AwsLogDriver.awsLogs({
         streamPrefix: 'batch-demo/container-logs' 
    });
    
    return new batch.EcsJobDefinition(this, 'jobDefinition', {
      propagateTags: true,
      retryAttempts: 3,
      //timeout: cdk.Duration.minutes(15),
      container: new batch.EcsEc2ContainerDefinition(this, 'containerDefinition', {
        image: ecs.ContainerImage.fromDockerImageAsset(image),
        jobRole: taskRole,
        logging: logConfig,
        memory: cdk.Size.mebibytes(1028),
        cpu: 1,
        environment: {
            // These should be provided at runtime when calling the batch.submitJob API :
            TOTAL_FRAMES_TO_RENDER: '',
            FRAMES_PER_RENDER_JOB: '',
            JOB_TYPE: ''
        },
        
      }),
    });
  
  }

  private grantSubmitBatchJobToRole(jobQueue: batch.JobQueue, jobDefinition: batch.EcsJobDefinition, jobTaskRole: iam.Role): void {
    jobTaskRole.attachInlinePolicy(
      new iam.Policy(this, 'submitJobToQueuePolicy', {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              'batch:SubmitJob'
            ],
            resources: [
              jobDefinition.jobDefinitionArn,
              jobQueue.jobQueueArn
            ]
          })
        ]
      })
    );
  } 

  /**
   * Creates a CloudForamtion stack output for each key-value pair in the `outputs` parameter.
   *
   * @private
   * @param {{[key: string]: string}} outputs
   * @memberof AwsBatchParallelJobsCdkStack
   */
  private addCloudFormationOutputs(outputs: {[key: string]: string}): void {
    Object.keys(outputs).forEach(key => {
      new cdk.CfnOutput(this, `CfnOutput_${key}`, {
        value: outputs[key],
      })
    });
  }

  private createVpcEndpoints(vpc: ec2.Vpc): void {
    
    // Sets up S3 Gateway Endpoint between your VPC and S3 in same region. 
    // Allows you to have private connection without need for traffic to pass
    // through internet gateway (IGW) or  NAT Gateway (NGW). Avoids the cost
    // of data transfer charges normally incurred over NGW.
    new ec2.GatewayVpcEndpoint(this, 'S3Vpce', {
      service:  ec2.GatewayVpcEndpointAwsService.S3,
      vpc,
    });
  }
}
