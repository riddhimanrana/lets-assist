"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DownloadCloud, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/utils/supabase/client";

interface MemberExporterProps {
  organizationId: string;
}

export default function MemberExporter({ organizationId }: MemberExporterProps) {
  const [isExporting, setIsExporting] = useState(false);
  
  const exportMembers = async () => {
    setIsExporting(true);
    const supabase = createClient();
    
    try {
      // Fetch all members with their profile data
      const { data, error } = await supabase
        .from("organization_members")
        .select(`
          id,
          role,
          joined_at,
          profiles:user_id (
            id,
            username,
            full_name,
            email,
            avatar_url
          )
        `)
        .eq("organization_id", organizationId);
      
      if (error) throw error;
      
      if (!data || data.length === 0) {
        toast.info("No members to export.");
        return;
      }
      
      // Format data for CSV
      const formattedData = data.map(member => ({
        id: member.id,
        user_id: member.profiles[0].id,
        role: member.role,
        username: member.profiles[0].username || "N/A",
        full_name: member.profiles[0].full_name || "N/A",
        email: member.profiles[0].email || "N/A",
        joined_at: new Date(member.joined_at).toISOString(),
      }));
      
      // Convert to CSV
      const headers = Object.keys(formattedData[0]);
      const csvRows = [
        headers.join(','), // header row
        ...formattedData.map(row => 
          headers.map(header => {
            let value = row[header as keyof typeof row];
            // Escape quotes and wrap in quotes if the value contains a comma
            value = String(value).includes(",") ? `"${String(value).replace(/"/g, '""')}"` : String(value);
            return value;
          }).join(',')
        )
      ];
      
      const csvString = csvRows.join('\n');
      
      // Create and trigger download
      const blob = new Blob([csvString], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.setAttribute('hidden', '');
      a.setAttribute('href', url);
      a.setAttribute('download', `organization-members-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      toast.success("Member data exported successfully");
    } catch (error) {
      console.error("Error exporting members:", error);
      toast.error("Failed to export member data");
    } finally {
      setIsExporting(false);
    }
  };
  
  return (
    <Button
      variant="outline"
      onClick={exportMembers}
      disabled={isExporting}
    >
      {isExporting ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Exporting...
        </>
      ) : (
        <>
          <DownloadCloud className="h-4 w-4 mr-2" />
          Export Member Data (CSV)
        </>
      )}
    </Button>
  );
}
