import { thisJob, workflowStepType, printJobRequestDetails, xray, writeToJobTable} from "./bin/common.js";
import * as startJob from "./bin/step-1-start.js";
import * as renderJob from "./bin/step-2-render.js";
import * as combineJob from "./bin/step-3-combine.js";


var segment = new xray.Segment("AWS Batch Job");
var ns = xray.getNamespace();


ns.run(async function() {
    try {        
        xray.setSegment(segment);
        await main();

    } catch (err) {
        segment.addError(err);
        segment.close();
        throw new Error('Job terminated due to error.', { cause: err});
    }
});


async function main() {
    
    printJobRequestDetails();

    switch (thisJob.WORKFLOW_STEP) {
        case workflowStepType.PLAN:
            await startJob.submitDownstreamBatchJobs();
            break;
        case workflowStepType.RENDER:
            await renderJob.renderFrames();
            break;
        case workflowStepType.ENCODE:
            await combineJob.combineFrames();
            break;
        default:
            throw new Error(`WORKFLOW_STEP=${thisJob.WORKFLOW_STEP} but expected one of: ${Object.values(workflowStepType).join(`, `)}`);
    }
}
