# Parralelization and Job Dependencies with AWS Batch

```sh
#!/bin/bash
set -e

cdk deploy --no-approval

STACK_NAME=AwsBatchParallelJobsCdkStack
outputs=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[].Outputs[]' --output json)
job_queue=$(echo $outputs | jq -r '.[] | select(.OutputKey == "CfnOutputBatchJobQueue") | .OutputValue')
job_definition=$(echo $outputs | jq -r '.[] | select(.OutputKey == "CfnOutputBatchJobDefinition") | .OutputValue')

aws batch submit-job \
    --job-name CLI-submission \
    --job-queue $job_queue \
    --job-definition $job_definition \
    --container-overrides \
        environment="[{name=JOB_TYPE,value=start},{name=TOTAL_FRAMES,value=120},{name=FRAMES_PER_RENDER_JOB,value=30}]"

...

...

...


// TODO: make sure ECS_AWSVPC_BLOCK_IMDS = true for ECS agent instance config