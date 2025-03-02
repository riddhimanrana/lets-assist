import { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import ProjectCreator from "./ProjectCreator";
import { Progress } from "@/components/ui/progress";

export const metadata: Metadata = {
  title: "Create Project",
  description: "Start a new volunteering project on Let's Assist and connect with volunteers to make a difference in your community.",
};

export default async function CreateProjectPage() {
  // Authentication check on the server
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    // Redirect unauthenticated users to login
    redirect("/login?redirect=/projects/create");
  }

  return (
    <div className="container mx-auto p-4 sm:p-8 max-w-3xl">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold mb-4">
          Create a Volunteering Project
        </h1>
        <Progress value={20} className="h-2" />
        <div className="grid grid-cols-5 mt-2 text-xs sm:text-sm text-muted-foreground">
          <span className="text-center sm:text-left truncate">
            Basic Info
          </span>
          <span className="text-center sm:text-left truncate">
            Event Type
          </span>
          <span className="text-center sm:text-left truncate">
            Schedule
          </span>
          <span className="text-center sm:text-left truncate">
            Settings
          </span>
          <span className="text-center sm:text-left">
            Finalize
          </span>
        </div>
      </div>
      
      {/* Client Component */}
      <ProjectCreator />
    </div>
  );
}
