import { writeToJobTable } from './common.js';

export const combineFrames = async () => { 
    const s3VideoObject = `s3://${thisJob.JOB_BUCKET}/encode/job-${thisJob.JOB_ID}/video.mp4`
    console.log(`Combining rendered frames into final asset. `);
    console.log(`<insert frame combining code here>`);
    console.log(`Frame combining complete.`);
    writeToJobTable({
        event: 'encodedFrames',
        s3VideoObject
    })
}