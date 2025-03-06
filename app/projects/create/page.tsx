import { Metadata } from "next";
import ProjectCreator from "./ProjectCreator";

export const metadata: Metadata = {
  title: "Create Project",
  description: "Start a new volunteering project on Let's Assist and connect with volunteers to make a difference in your community.",
};

export default async function CreateProjectPage() {
  // Authentication check on the server

  return (
    <div className="container mx-auto p-4 sm:p-8 max-w-3xl">
      {/* Client Component */}
      <ProjectCreator />
    </div>
  );
}
