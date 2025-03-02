import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { logout } from "@/app/logout/actions";
import DemoClientComponent from "@/components/DemoClientComponent";

export default async function Dashboard() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    redirect("/login");
  }
  return (
    <div>
      <main className="p-8">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-3xl font-bold">Hello, {data.user.email}</h1>
          <form>
            <Button
              type="submit"
              variant="outline"
              className="bg-red-500 hover:bg-red-600 text-white"
              formAction={logout}
            >
              Logout
            </Button>
          </form>
        </div>
        <p>Welcome to your volunteering platform dashboard.</p>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Events</CardTitle>
            </CardHeader>
            <CardContent>
              {/* List your upcoming volunteering events here */}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Your Activities</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Display recent activities or stats */}
            </CardContent>
          </Card>
        </div>
        <Button className="mt-8">Create New Event</Button>
        <DemoClientComponent />
      </main>
    </div>
  );
}
