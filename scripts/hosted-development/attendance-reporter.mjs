// Hosted output contains outcomes only. Never forward browser errors or attachments.
// A failure may name one fixed journey stage, and only when the test's own
// error is exactly the reviewed stage message for a known code.
import { reportedStage } from "./attendance-stages.mjs";

export default class AttendanceReporter {
  constructor(
    _options,
    write = (line) => {
      process.stdout.write(`${line}\n`);
    },
  ) {
    this.write = write;
  }
  onBegin() {
    this.write("Hosted attendance acceptance started.");
  }
  onTestEnd(_test, result) {
    if (result.status === "passed") {
      this.write("Hosted attendance guest journey: passed.");
      return;
    }
    const stage = reportedStage(result.errors);
    this.write(
      stage
        ? `Hosted attendance guest journey: failed at ${stage} (ATTENDANCE_JOURNEY_FAILED).`
        : "Hosted attendance guest journey: failed (ATTENDANCE_JOURNEY_FAILED).",
    );
  }
  onError(_error) {
    this.write("Hosted attendance runner failed (ATTENDANCE_RUNNER_FAILED).");
  }
  onStdOut(_chunk) {}
  onStdErr(_chunk) {}
  onEnd(result) {
    this.write(
      result.status === "passed"
        ? "Hosted attendance acceptance passed."
        : "Hosted attendance acceptance failed.",
    );
  }
}
