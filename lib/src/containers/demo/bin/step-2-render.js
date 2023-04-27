import { thisJob, writeToJobTable } from './common.js';


export const renderFrames = async () => {
    let jobIndex = thisJob.JOB_ARRAY_INDEX;
    let s3FrameObjects = [];
    let frameCount = thisJob.FRAME_COUNT;
    console.log(`=== Frame rendering started for array job index ${jobIndex} === `);
    
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        const frameNumber = (frameIndex+1) * (jobIndex+1);
        s3FrameObjects.push(`s3://${thisJob.JOB_BUCKET}/render/job-${thisJob.JOB_ID}/${frameNumber}.jpg`);
        console.log(`Rendered frame ${frameNumber}`);
    }
    console.log(`Frame rendering complete.`); 
    await writeToJobTable({
        event: 'renderedFrames',
        frameCount,
        s3FrameObjects
    });
}
