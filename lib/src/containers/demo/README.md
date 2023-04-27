# Demo Container Image for AWS Batch 

This directory contains a simple NodeJS container which runs a script that does one of three workflow steps:

1. Plan - Submits a downstream AWS Batch array job to render mini-batches of frames in parallel, and submits a downstream final encoding job that has a dependency on the render job first completing. 

2. Render - AWS Batch will run N parallel jobs, and each job will render a mini-batch of the total number of frames needed.

3. Encode - A single job that retrieves all rendered frames, encodes them into a single video. 

## Container structure

This first pass demo uses a single container for all three jobs, though we'd recommend using one distinct container image per AWS Batch job definition.

## Workflow orchestration

The current design mixes workflow logic and application logic in the same application code base. For small, simple workflows this may be manageable, but becomes more difficult as workflow complexity increases. 

For example, image a workflow with 10 steps that encounteres a failure in step 9. You might look at Step 9 and realize the error was due to an unexpected value passed from Step 8, find that Step 8 had an issue in Step 7, and so on. 

Rather than being forced to piece such issues together, you may consider one or both of:

1. **Lifting workflow logic up, out of application code** - By using a service like AWS Step Functions or opensource [Temporal](temporal.io), you can have a much clearer picture of your workflow and leverage benefits such as composability of workflows.

2. **Distributed tracing** - consider using a distributed tracing solution such as AWS X-Ray or [Lumigo.io][https://lumigo.io] to simplify deep dive analysis of distributed application performance and troubleshooting. This project has a partial implementation of AWS X-Ray, though more work is needed to really demonstrate it's capabilities. 

## Environment Variables

Each AWS Batch job definition has a common set of environment variables configured in the `containerOverrides` property of the job definition. These variables are used to provide examples of how you can provide the names or locations of shared resources, like a DynamoDB table used to log job results or pass data between jobs, or an S3 bucket to store rendered frames and encoded video.

In addition, the plan job uses environment variable overrides to pass necessary runtime information to downstream jobs, such as how many frames to render or the location of the creative code needed to generate the frames. 

Similarly, your application can pass runtime configuration to the planning job when calling the `SubmitJob()` API.