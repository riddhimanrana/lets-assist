"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProgressCircle } from "./ProgressCircle";
import { createClient } from "@/utils/supabase/client";
import { toast } from "sonner";
import { PencilIcon, SaveIcon, CheckCircle, Clock, Users, Target } from "lucide-react";
// Import the type for the goals data
import { VolunteerGoalsData } from "@/types";

// Copy the formatting function from page.tsx
function formatTotalDuration(totalHours: number): string {
  if (totalHours <= 0) return "0m"; // Handle zero or negative hours

  // Convert decimal hours to total minutes, rounding to nearest minute
  const totalMinutes = Math.round(totalHours * 60);

  if (totalMinutes === 0) return "0m"; // Handle cases that round down to 0

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  let result = "";
  if (hours > 0) {
    result += `${hours}h`;
  }
  if (remainingMinutes > 0) {
    // Add space if hours were also added
    if (hours > 0) {
      result += " ";
    }
    result += `${remainingMinutes}m`;
  }

  // Fallback in case result is somehow empty (e.g., very small positive number rounds to 0 minutes)
  return result || (totalMinutes > 0 ? "1m" : "0m");
}

interface GoalsProps {
  userId: string;
  totalHours: number; // This is received as decimal hours
  totalEvents: number;
}

// Use the imported type
interface Goals extends VolunteerGoalsData {}

export function VolunteerGoals({ userId, totalHours, totalEvents }: GoalsProps) {
  const [goals, setGoals] = useState<Goals>({
    hours_goal: 0,
    events_goal: 0,
  });

  const [editingHours, setEditingHours] = useState(false);
  const [editingEvents, setEditingEvents] = useState(false);
  const [tempHoursGoal, setTempHoursGoal] = useState("");
  const [tempEventsGoal, setTempEventsGoal] = useState("");
  const [loading, setLoading] = useState(true);

  // Calculate percentages (no change needed here)
  const hoursPercentage = goals.hours_goal > 0 ? Math.min(100, (totalHours / goals.hours_goal) * 100) : 0;
  const eventsPercentage = goals.events_goal > 0 ? Math.min(100, (totalEvents / goals.events_goal) * 100) : 0;

  useEffect(() => {
    async function fetchGoals() {
      try {
        const supabase = createClient();

        // Fetch the volunteer_goals JSONB field from the profiles table
        const { data: profileData, error } = await supabase
          .from("profiles")
          .select("volunteer_goals") // Select the JSONB column
          .eq("id", userId)
          .single();

        if (error) {
          console.error("Error fetching profile goals:", error);
          toast.error("Failed to load your volunteering goals");
        }

        // Parse the JSONB data or use defaults
        if (profileData?.volunteer_goals) {
          // Type assertion to ensure data matches VolunteerGoalsData
          const goalsData = profileData.volunteer_goals as VolunteerGoalsData;
          setGoals({
            hours_goal: goalsData.hours_goal || 0,
            events_goal: goalsData.events_goal || 0
          });
        } else {
          // If volunteer_goals is null or undefined, set default goals
          setGoals({ hours_goal: 0, events_goal: 0 });
        }

      } catch (error) {
        console.error("Error in fetchGoals:", error);
      } finally {
        setLoading(false);
      }
    }

    if (userId) {
      fetchGoals();
    }
  }, [userId]);

  const saveGoal = async (type: 'hours' | 'events') => {
    try {
      const supabase = createClient();

      // Parse the temporary input values
      const newHoursGoal = type === 'hours'
        ? parseInt(tempHoursGoal) || 0
        : goals.hours_goal;

      const newEventsGoal = type === 'events'
        ? parseInt(tempEventsGoal) || 0
        : goals.events_goal;

      // Validate the input (no negative numbers)
      if ((type === 'hours' && newHoursGoal < 0) ||
          (type === 'events' && newEventsGoal < 0)) {
        toast.error("Goals cannot be negative numbers");
        return;
      }

      // Construct the JSONB object to update
      const updatedGoalsData: VolunteerGoalsData = {
        hours_goal: newHoursGoal,
        events_goal: newEventsGoal,
      };

      // Update the volunteer_goals column in the profiles table
      const { error } = await supabase
        .from("profiles")
        .update({ volunteer_goals: updatedGoalsData }) // Update the JSONB column
        .eq("id", userId); // Filter by user ID

      if (error) {
        throw error;
      }

      // Update the local state
      setGoals(updatedGoalsData);

      // Exit editing mode
      if (type === 'hours') {
        setEditingHours(false);
      } else {
        setEditingEvents(false);
      }
      toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} goal updated`);

    } catch (error) {
      console.error(`Error saving ${type} goal:`, error);
      toast.error(`Failed to update your ${type} goal`);
    }
  };

  // Handle start editing
  const startEditing = (type: 'hours' | 'events') => {
    if (type === 'hours') {
      setTempHoursGoal(goals.hours_goal.toString());
      setEditingHours(true);
    } else {
      setTempEventsGoal(goals.events_goal.toString());
      setEditingEvents(true);
    }
  };

  // Handle cancel editing
  const cancelEditing = (type: 'hours' | 'events') => {
    if (type === 'hours') {
      setEditingHours(false);
    } else {
      setEditingEvents(false);
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center">
        <div className="animate-pulse">Loading your goals...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hours Goal */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="font-medium">Hours Goal</div>
          <div className="text-sm text-muted-foreground">
            {goals.hours_goal > 0
              ? // Use formatTotalDuration for both current and goal hours
                `${formatTotalDuration(Math.min(totalHours, goals.hours_goal))} / ${formatTotalDuration(goals.hours_goal)} completed`
              : "Set a target for volunteer hours"}
          </div>

          {/* Edit interface for hours */}
          {editingHours ? (
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="number"
                min="0"
                value={tempHoursGoal}
                onChange={(e) => setTempHoursGoal(e.target.value)}
                className="w-20 h-8"
                autoFocus
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => saveGoal('hours')}
                className="h-8 w-8"
              >
                <SaveIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => cancelEditing('hours')}
                className="h-8 w-8"
              >
                <Target className="h-4 w-4" /> {/* Changed X to Target for consistency */}
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => startEditing('hours')}
              className="mt-1 h-8 px-2 text-xs"
            >
              <PencilIcon className="h-3 w-3 mr-1" />
              {goals.hours_goal > 0 ? "Edit Goal" : "Set Goal"}
            </Button>
          )}
        </div>

        {/* Progress circle for hours */}
        <div className="w-16 h-16">
          <ProgressCircle
            value={hoursPercentage}
            size={64}
            strokeWidth={5}
            showLabel={goals.hours_goal > 0}
          />
        </div>
      </div>

      {/* Events Goal */}
      <div className="flex items-center justify-between pt-2 border-t">
        <div className="space-y-1">
          <div className="font-medium">Projects Goal</div>
          <div className="text-sm text-muted-foreground">
            {goals.events_goal > 0
              ? `${Math.min(totalEvents, goals.events_goal)}/${goals.events_goal} projects completed`
              : "Set a target for volunteer projects"}
          </div>

          {/* Edit interface for events */}
          {editingEvents ? (
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="number"
                min="0"
                value={tempEventsGoal}
                onChange={(e) => setTempEventsGoal(e.target.value)}
                className="w-20 h-8"
                autoFocus
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => saveGoal('events')}
                className="h-8 w-8"
              >
                <SaveIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => cancelEditing('events')}
                className="h-8 w-8"
              >
                <Target className="h-4 w-4" /> {/* Changed X to Target for consistency */}
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => startEditing('events')}
              className="mt-1 h-8 px-2 text-xs"
            >
              <PencilIcon className="h-3 w-3 mr-1" />
              {goals.events_goal > 0 ? "Edit Goal" : "Set Goal"}
            </Button>
          )}
        </div>

        {/* Progress circle for events */}
        <div className="w-16 h-16">
          <ProgressCircle
            value={eventsPercentage}
            size={64}
            strokeWidth={5}
            showLabel={goals.events_goal > 0}
          />
        </div>
      </div>

      {/* Achievement indicators */}
      {(hoursPercentage >= 100 || eventsPercentage >= 100) && (
        <div className="rounded-md bg-primary/10 p-3 mt-4 flex items-start gap-3">
          <CheckCircle className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <p className="font-medium text-sm">Goal achieved!</p>
            <p className="text-xs text-muted-foreground mt-1">
              Congratulations on reaching your volunteering goal!
              Consider setting a new target to continue your impact.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
