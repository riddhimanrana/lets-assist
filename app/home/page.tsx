import React from 'react';
import { Card } from '@/components/ui/card';
import { createClient } from '@/utils/supabase/server';
import { EmailVerificationToast } from "@/components/EmailVerificationToast";
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { MapPin, Users, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { NoAvatar } from '@/components/NoAvatar';

export default async function Home() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profileData } = await supabase
                    .from('profiles')
                    .select('full_name, avatar_url, username')
                    .eq('id', user?.id)
                    .single();
    const userName = profileData?.full_name || 'JD';

    // This is just mock data for UI purposes
    const mockProjects = [
        {
            id: '1',
            title: 'Santa Cruz Beach Cleanup',
            location: 'Santa Cruz Main Beach, CA',
            creator: 'Jane Doe',
            slots: [
                { day: 'Saturday', times: ['9:30 AM - 11:30 AM', '2:00 PM - 4:00 PM'], capacity: 10 },
                { day: 'Sunday', times: ['10:00 AM - 12:00 PM', '2:00 PM - 4:00 PM'], capacity: 15 }
            ],
            totalSpots: 50,
            spotsLeft: 35
        },
        // Add more mock projects here for testing
    ];

    return (
        <div className="min-h-screen">
            <EmailVerificationToast />
            <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <div className="flex items-center gap-3">
                        <Avatar className="w-10 h-10">
                            <AvatarImage src={profileData?.avatar_url} alt={userName} />
                            <AvatarFallback>
                                <NoAvatar fullName={profileData?.full_name} />
                            </AvatarFallback>
                        </Avatar>
                        <div>
                            <h1 className="text-3xl font-bold">Hi, {userName}</h1>
                            <p className="text-sm text-muted-foreground">Check out the latest projects</p>
                        </div>
                    </div>
                    <Link href="/projects/create" className="w-full md:w-auto">
                        <Button size="lg" className="font-semibold flex items-center gap-1 w-full md:w-auto">
                            <Plus className="h-10 w-10" />
                            Create Project
                        </Button>
                    </Link>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {mockProjects.map((project) => (
                        <Card key={project.id} className="p-4 hover:shadow-lg transition-shadow">
                            <div className="flex flex-col md:flex-row justify-between items-start mb-3 gap-2">
                                <div className="flex gap-3 items-center">
                                    <Avatar className="w-12 h-12">
                                        <AvatarImage src="" alt={project.creator} />
                                        <AvatarFallback>
                                            <NoAvatar fullName={project.creator} />
                                        </AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <h2 className="text-xl font-semibold">{project.title}</h2>
                                        <div className="flex items-center text-muted-foreground gap-1">
                                            <MapPin className="h-4 w-4" />
                                            <span className="text-sm">{project.location}</span>
                                        </div>
                                        <span className="font-medium text-sm mt-1 block">{project.creator}</span>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <p className="text-sm font-medium mb-1">Available Days:</p>
                                <div className="flex flex-wrap gap-2">
                                    {project.slots.map((slot, index) => (
                                        <Badge key={index} variant="outline" className="px-2 py-1 text-xs">
                                            {slot.day}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                            <div className="mt-4">
                                <Badge variant="secondary" className="inline-flex items-center gap-1 px-2 py-1">
                                    <Users className="h-4 w-4" />
                                    <span className="text-xs">{project.spotsLeft} spots left</span>
                                </Badge>
                            </div>
                        </Card>
                    ))}
                </div>
            </main>
        </div>
    );
}
