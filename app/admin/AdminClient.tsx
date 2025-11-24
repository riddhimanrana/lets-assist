"use client";

import { useState } from "react";
import { AdminSidebar } from "./components/AdminSidebar";
import { OverviewTab } from "./components/OverviewTab";
import { FeedbackTab } from "./components/FeedbackTab";
import { TrustedMembersTab } from "./components/TrustedMembersTab";
import { ModerationTab } from "./components/ModerationTab";
import { updateTrustedMemberStatus, deleteFeedback } from "./actions";
import { toast } from "sonner";

type FeedbackType = "issue" | "idea" | "other";

interface Profile {
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

interface Feedback {
  id: string;
  user_id: string;
  section: FeedbackType;
  email: string;
  title: string;
  feedback: string;
  created_at: string;
  profiles: Profile | null;
}

interface TrustedMemberApplication {
  id: string;
  user_id?: string;
  name: string;
  email: string;
  reason: string;
  status: boolean | null;
  created_at: string;
  profiles: Profile | null;
}

interface ModerationStats {
  total: number;
  pending: number;
  blocked: number;
  critical: number;
  recentWeek: number;
  monthlyActivity: number;
}

interface ReportsStats {
  total: number;
  pending: number;
  resolved: number;
  highPriority: number;
  recentWeek: number;
}

interface ContentReport {
  id: string;
  reason: string;
  priority: string;
  content_type: string;
  description: string;
  content_details?: {
    title?: string;
    full_name?: string;
  };
  creator_details?: {
    avatar_url?: string;
    full_name: string;
    username: string;
  };
}

interface FlaggedContent {
  id: string;
  is_ai_flagged?: boolean;
  flag_type: string;
  confidence_score: number;
  content_type: string;
  reason?: string;
  flag_details?: {
    reasoning?: string;
    full_analysis?: Record<string, unknown>;
  };
}

interface AdminClientProps {
  feedback: Feedback[];
  applications: TrustedMemberApplication[];
  moderationStats?: ModerationStats;
  flaggedContent?: FlaggedContent[];
  contentReports?: ContentReport[];
  reportsStats?: ReportsStats;
}

export function AdminClient({ 
  feedback: initialFeedback, 
  applications: initialApplications,
  moderationStats,
  flaggedContent: initialFlaggedContent = [],
  contentReports: initialContentReports = [],
  reportsStats,
}: AdminClientProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [feedback, setFeedback] = useState(initialFeedback);
  const [applications, setApplications] = useState(initialApplications);
  
  const handleApprove = async (id: string, userId: string) => {
    const result = await updateTrustedMemberStatus(userId, true);
    if (result.error) {
      toast.error("Error", { description: result.error });
    } else {
      toast.success("Approved", { description: "Trusted member application approved." });
      setApplications(prev => prev.map(app => app.id === id ? { ...app, status: true } : app));
    }
  };

  const handleDeny = async (id: string, userId: string) => {
    const result = await updateTrustedMemberStatus(userId, false);
    if (result.error) {
      toast.error("Error", { description: result.error });
    } else {
      toast.success("Denied", { description: "Trusted member application denied." });
      setApplications(prev => prev.map(app => app.id === id ? { ...app, status: false } : app));
    }
  };

  const handleRevoke = async (id: string, userId: string) => {
    const result = await updateTrustedMemberStatus(userId, false);
    if (result.error) {
      toast.error("Error", { description: result.error });
    } else {
      toast.success("Revoked", { description: "Trusted member status revoked." });
      setApplications(prev => prev.map(app => app.id === id ? { ...app, status: false } : app));
    }
  };

  const handleDeleteFeedback = async (id: string) => {
    const result = await deleteFeedback(id);
    if (result.error) {
      toast.error("Error", { description: result.error });
    } else {
      toast.success("Deleted", { description: "Feedback deleted successfully." });
      setFeedback(prev => prev.filter(f => f.id !== id));
    }
  };
  
  // Map data to components
  const overviewStats = {
    feedbackCount: feedback.length,
    trustedPendingCount: applications.filter(a => a.status === null).length,
    flaggedPendingCount: moderationStats?.pending || 0,
    reportsPendingCount: reportsStats?.pending || 0,
  };

  const mappedFeedback = feedback.map(f => ({
    id: f.id,
    section: f.section,
    title: f.title,
    feedback: f.feedback,
    created_at: f.created_at,
    email: f.email,
    profiles: f.profiles
  }));

  const mappedTrustedMembers = applications.map(app => ({
    id: app.id,
    user_id: app.user_id,
    status: app.status,
    created_at: app.created_at,
    email: app.email,
    name: app.name,
    reason: app.reason,
    profiles: app.profiles
  }));

  return (
    <div className="flex min-h-screen bg-muted/10">
      <AdminSidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-1 p-8 overflow-y-auto h-screen">
        <div className="max-w-6xl mx-auto">
          {activeTab === "overview" && (
            <OverviewTab 
              stats={overviewStats} 
              setActiveTab={setActiveTab}
            />
          )}
          
          {activeTab === "feedback" && (
            <FeedbackTab 
              feedback={mappedFeedback} 
              onDelete={handleDeleteFeedback}
            />
          )}
          
          {activeTab === "trusted-members" && (
            <TrustedMembersTab 
              trustedMembers={mappedTrustedMembers} 
              onApprove={handleApprove}
              onDeny={handleDeny}
              onRevoke={handleRevoke}
            />
          )}
          
          {activeTab === "moderation" && (
            <ModerationTab 
              flaggedContent={initialFlaggedContent} 
              contentReports={initialContentReports} 
            />
          )}
        </div>
      </main>
    </div>
  );
}