import React from "react";
import { Metadata } from "next";
import { ProjectsInfiniteScroll } from "@/components/projects/ProjectsInfiniteScroll";
import Link from "next/link"
import { createClient } from "@/utils/supabase/server";
import UserProjects from "./UserProjects"
async function getUserData() {
    const supabase = await createClient(); // (/Users/riddhiman.rana/Desktop/Coding/lets-assist/app/projects/page.tsx, line 2)
    return supabase.auth.getUser();
}

export async function generateMetadata(): Promise<Metadata> {
    const {
        data: { user },
    } = await getUserData(); // (/Users/riddhiman.rana/Desktop/Coding/lets-assist/app/projects/page.tsx, line 12)
    if (user) {
        return {
            title: "My Projects",
            description: "Manage and view your volunteer projects.",
        };
    } else {
        return {
            title: "Volunteer Projects",
            description:
                "Browse volunteer opportunities in your area. Connect with your community and make a difference today.",
        };
    }
}

export default async function ProjectsPage() {
    const {
        data: { user },
    } = await getUserData(); // (/Users/riddhiman.rana/Desktop/Coding/lets-assist/app/projects/page.tsx, line 29)
    console.log("User data:", user); // Debugging line
    if (user) {
        return <UserProjects />;
    }
    // Default content for non-authenticated users
    return (
        <div className="min-h-screen">
            <main className="mx-auto px-4 sm:px-8 lg:px-12 py-8">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <div>
                        <h1 className="text-3xl font-bold">Volunteer Projects</h1>
                        <p className="text-sm text-muted-foreground">
                            Browse available volunteer opportunities
                        </p>
                    </div>
                    <div className="flex gap-3 items-center text-muted-foreground text-sm">
                        <Link 
                            href="/login" 
                            className="px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md text-sm font-medium transition-colors"
                        >
                            Log in
                        </Link>
                        or
                        <Link
                            href="/signup"
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
                        >
                            Sign Up
                        </Link>
                        <span className="text-sm text-muted-foreground">to create projects</span>
                    </div>
                </div>
                {/* Render the infinite scroll component */}
                <ProjectsInfiniteScroll />
            </main>
        </div>
    );
}