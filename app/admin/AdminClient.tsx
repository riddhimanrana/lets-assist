"use client";

import { useState } from "react";
import { AdminSidebar } from "./components/AdminSidebar";
import { OverviewTab } from "./components/OverviewTab";
import { FeedbackTab } from "./components/FeedbackTab";
import { TrustedMembersTab } from "./components/TrustedMembersTab";
import { ModerationTab } from "./components/ModerationTab";
import { deleteFeedback } from "./actions";
import { toast } from "sonner";

type FeedbackType = "issue" | "idea" | "other";

interface Profile {
  full_name: string | null;
  email: string | null;
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
  const [applications] = useState(initialApplications);
  


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

  return (
    <div className="flex h-screen bg-gray-50">
      <AdminSidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 overflow-auto">
        {activeTab === "overview" && (
          <OverviewTab
            stats={overviewStats}
            flaggedContent={initialFlaggedContent}
            reportPreview={initialContentReports.slice(0, 4)}
            reportsStats={reportsStats || {
              total: 0,
              pending: 0,
              resolved: 0,
              highPriority: 0,
              recentWeek: 0,
            }}
          />
        )}
        {activeTab === "feedback" && (
          <FeedbackTab
            feedback={feedback}
            onDelete={handleDeleteFeedback}
          />
        )}
        {activeTab === "trusted-members" && (
          <TrustedMembersTab
            trustedMembers={applications}
          />
        )}
        {activeTab === "moderation" && (
          <ModerationTab
            flaggedContent={initialFlaggedContent}
            contentReports={initialContentReports}
          />
        )}
      </div>
    </div>
  );
}