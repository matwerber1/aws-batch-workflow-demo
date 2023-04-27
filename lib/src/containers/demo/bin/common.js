
import { Batch } from "@aws-sdk/client-batch";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { fromContainerMetadata } from "@aws-sdk/credential-providers";
import * as dotenv from 'dotenv';
import AWSXRay from "aws-xray-sdk-core";
dotenv.config();


const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
const isRunningInECS = (process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI);
const credentials = isRunningInECS ? fromContainerMetadata() : undefined;


AWSXRay.config([AWSXRay.plugins.ECSPlugin]);
AWSXRay.captureHTTPsGlobal(import('https'));
export const xray = AWSXRay;


export const batch = AWSXRay.captureAWSv3Client(
    new Batch({
        region,
        credentials,
    })
);

export const dynamodbClient = AWSXRay.captureAWSv3Client(
    DynamoDBDocument.from(
        new DynamoDB({
            region,
            credentials,
        })
    )
);

export const thisJob = {
    // Supplied by AWS Batch by default:
    JOB_ID: process.env.AWS_BATCH_JOB_ID,
    JOB_ATTEMPT:process.env.AWS_BATCH_JOB_ATTEMPT,
    JOB_ARRAY_INDEX: process.env.AWS_BATCH_JOB_ARRAY_INDEX,
    QUEUE_NAME: process.env.AWS_BATCH_JQ_NAME,
    COMPUTE_ENVIRONMENT: process.env.AWS_BATCH_CE_NAME,
    // Baked into job definition defaults: 
    WORKFLOW: process.env.WORKFLOW,
    WORKFLOW_STEP: process.env.WORKFLOW_STEP,
    JOB_TABLE: process.env.JOB_TABLE,
    JOB_BUCKET: process.env.JOB_BUCKET
};


// One example of using a shared DynamoDB table:
export const writeToJobTable = async (data) => {
    let sortKey = `step-${thisJob.WORKFLOW_STEP}`;
    if (thisJob.JOB_ARRAY_INDEX) { 
        sortKey += `_array-${thisJob.JOB_ARRAY_INDEX}`;
    }
    sortKey += `_attempt-${thisJob.JOB_ATTEMPT}_${unixTimestamp()}`
    const item = {
      pk: `workflow-${thisJob.JOB_ID}`,
      sk: sortKey,
      WORKFLOW: thisJob.WORKFLOW,
      WORKFLOW_STEP: thisJob.WORKFLOW_STEP,
      queue: thisJob.QUEUE_NAME,
      ...data
    };
  
    const params = {
      TableName: process.env.JOB_TABLE, // Replace with your DynamoDB table name
      Item: item
    };
  
    await dynamodbClient.put(params);
}


export const printJobRequestDetails = function() {
    console.log(`Job request detail:`);
    console.log(JSON.stringify(thisJob, null, 2));
}


// expected values for WORKFLOW_STEP environment variable:
export const workflowStepType = {
    PLAN: 'plan',
    RENDER: 'render',
    ENCODE: 'encode'
};


function unixTimestamp () {  
    return Math.floor(Date.now() / 1000)
  }