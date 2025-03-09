import React from "react";
import { Metadata } from "next";
import { ProjectsInfiniteScroll } from "@/components/ProjectsInfiniteScroll";
import Link from "next/link"

export const metadata: Metadata = {
    title: "Volunteer Projects",
    description: "Browse volunteer opportunities in your area. Connect with your community and make a difference today.",
};

export default function ProjectsPage() {
    return (
        <div className="min-h-screen">
            <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
