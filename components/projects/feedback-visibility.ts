/**
 * Who can read project feedback, in plain words. It matches the current
 * server rules (the feedback SELECT policy and getProjectFeedbackSummary):
 * the volunteer who wrote it, the people who manage the project, and
 * Let's Assist administrators. It is never shown on the public project page.
 * This copy explains those rules; it does not change them.
 */
export const PROJECT_FEEDBACK_VISIBILITY =
  "Your feedback is private and never shown on the project page. You, the people who manage this project and Let's Assist administrators can read it. Your name is shown with your feedback.";

export const PROJECT_FEEDBACK_SAVED_MESSAGE =
  "Thanks. Your feedback was sent to the people who manage this project.";
