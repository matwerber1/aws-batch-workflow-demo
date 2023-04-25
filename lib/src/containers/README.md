# Demo Container Image for AWS Batch 

This directory contains a simple NodeJS script which performs one of three mock workflow steps depending on the value of a `JOB_TYPE` environment variable that is passed as an environment variable container override in the `SubmitJob` API request. 

## Testing locally

```sh
docker build -t aws-batch-demo .
docker run --rm -it  --entrypoint bash --env-file .env aws-batch-demo:latest
docker run --rm -it --env-file .env aws-batch-demo:latest
```

## Workflow 

The workflow is as follows: 

1. Your application (or a developer) issues the `SubmitJob()` API with `JOB_TYPE = start`: 

    1. Calculate the number of array jobs needed to all render frames as `arraySize = TOTAL_FRAMES / FRAMES_PER_RENDER_JOB`. These two environment variables would also need to have been provided as container overrides to the original workflow start job. 

    1. Use the AWS Batch `SubmitJob()` API to schedule a mock rendering job using the same container image from this directory. The job request parameters will contain `arraySize = <result from calculation above>`, along with `JOB_TYPE = render`. The array size tells AWS Batch to submit `N` child jobs under the parent rendering job. These jobs will use the same container image, queue, and job definition, with the only difference being that AWS Batch will inject the 0-indexed environment variable `AWS_BATCH_JOB_ARRAY_INDEX` so that the container knows which portion of the total frame set it is responsible for processing. 

    1. Use the AWS Batch `SubmitJob()` API to schedule a final combine job which is responsible for combining the individual frames from the render job into a completed video. The `SubmitJob()` API parameters include an explicit job dependency on the parent job ID for the prior rendering job. This means that our combine step will not execute until all rendering jobs are completed. If any of these rendering job fails, the overall rendering job and combine job will also fail. 

2. Each array job within the overall rendering job submission will start and either complete or fail. When each array job is started, the environment variable value of `JOB_TYPE = render` causes a switch statement to direct execution to the proper code path. 

3. If all rendering array jobs complete, the dependency for the compile job will have been met and AWS Batch will then launch the final compile job. As with the rendering job, `index.js` uses a switch statement on `JOB_TYPE = compile` environment variable to choose the correct code path. 