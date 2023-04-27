import { workflowStepType, thisJob, batch, writeToJobTable } from './common.js';
import _ from 'lodash';


export const submitDownstreamBatchJobs = async () => {
    const renderJobId = await submitJob(
        workflowStepType.RENDER,
        process.env.RENDER_JOB_QUEUE, 
        process.env.RENDER_JOB_DEFINITION
    );
    const encodeJobId = await submitJob(
        workflowStepType.ENCODE, 
        process.env.ENCODE_JOB_QUEUE,
        process.env.ENCODE_JOB_DEFINITION,
        renderJobId
    );
}


const submitJob = async (workflowStep, jobQueue, jobDefinition, dependsOnJobId=undefined) => {
    let jobSubmitParameters = { 
        jobName: (`${thisJob.WORKFLOW}-${workflowStep}-submittedBy-${thisJob.WORKFLOW_STEP}-${thisJob.JOB_ID}`),
        jobQueue: jobQueue,
        jobDefinition: jobDefinition, 
    };
    
    let jobArraySize;

    // Submit render job as an array job to perform work in parallel:
    if (workflowStep === workflowStepType.RENDER) {
        const totalFrames = process.env.TOTAL_FRAMES;
        const framesPerRenderJob = process.env.FRAMES_PER_RENDER_JOB;
        if (!_.inRange(totalFrames, 1, 10001)) { 
            throw new Error(`TOTAL_FRAMES=${totalFrames}, expected number between 1 to 10000.`)
        }
        if (!_.inRange(framesPerRenderJob, 1, 1001)) {
            throw new Error(`FRAMES_PER_RENDER_JOB=${framesPerRenderJob}, expected number between 1 to 1000.`)
        }
        jobArraySize = Math.ceil(totalFrames / framesPerRenderJob);
        jobSubmitParameters.arrayProperties = { size: jobArraySize };
        jobSubmitParameters.containerOverrides = {
             environment: [ 
                { 
                    name: 'FRAMES_PER_RENDER_JOB', 
                    value: framesPerRenderJob 
                }
            ]
        }
    }
    if (dependsOnJobId) { 
        jobSubmitParameters.dependsOn = [
            {
                jobId: dependsOnJobId
            }
        ];
    }

    
    console.log(`Submitting ${workflowStep} job: ${JSON.stringify(jobSubmitParameters, null, 2)}`);
    const response = await batch.submitJob(
        jobSubmitParameters
    );
    const jobId = response.jobId;
    console.log(`Job submitted: ${jobId}`);
    await writeToJobTable({
        event: 'submittedJob',
        jobSubmitParameters
    });
    return jobId;
}
