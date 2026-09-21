// Hosted output contains outcomes only. Never forward browser errors or attachments.
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
    const passed = result.status === "passed";
    this.write(
      passed
        ? "Hosted attendance guest journey: passed."
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
