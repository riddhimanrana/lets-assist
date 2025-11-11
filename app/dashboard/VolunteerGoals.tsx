"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProgressCircle } from "./ProgressCircle";
import { createClient } from "@/utils/supabase/client";
import { toast } from "sonner";
import { PencilIcon, SaveIcon, CheckCircle, Clock, Users, Target, Calendar } from "lucide-react";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { startOfMonth, endOfMonth, startOfYear, endOfYear, addMonths, format } from "date-fns";
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

// Define semester periods
const getSemesterPeriods = () => {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  
  // Determine current semester
  let currentSemester = '';
  if (currentMonth >= 7 && currentMonth <= 11) { // Aug-Dec
    currentSemester = 'fall';
  } else if (currentMonth >= 0 && currentMonth <= 4) { // Jan-May
    currentSemester = 'spring';
  } else { // May-Aug
    currentSemester = 'summer';
  }

  return {
    'current-year': {
      label: `Academic Year ${currentYear}`,
      from: new Date(currentYear, 7, 1), // August 1st
      to: new Date(currentYear + 1, 6, 31) // July 31st next year
    },
    'fall-semester': {
      label: `Fall ${currentSemester === 'fall' ? currentYear : currentYear - 1}`,
      from: new Date(currentSemester === 'fall' ? currentYear : currentYear - 1, 7, 1), // August 1st
      to: new Date(currentSemester === 'fall' ? currentYear : currentYear - 1, 11, 31) // December 31st
    },
    'spring-semester': {
      label: `Spring ${currentSemester === 'spring' ? currentYear : currentYear + 1}`,
      from: new Date(currentSemester === 'spring' ? currentYear : currentYear + 1, 0, 1), // January 1st
      to: new Date(currentSemester === 'spring' ? currentYear : currentYear + 1, 4, 31) // May 31st
    },
    'summer-semester': {
      label: `Summer ${currentSemester === 'summer' ? currentYear : currentYear + 1}`,
      from: new Date(currentSemester === 'summer' ? currentYear : currentYear + 1, 5, 1), // June 1st
      to: new Date(currentSemester === 'summer' ? currentYear : currentYear + 1, 7, 31) // August 31st
    },
    'lifetime': {
      label: 'Lifetime',
      from: undefined,
      to: undefined
    }
  };
};

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
  
  // Date range state
  const [selectedPeriod, setSelectedPeriod] = useState<string>('lifetime');
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>();
  const [filteredHours, setFilteredHours] = useState(totalHours);
  const [filteredEvents, setFilteredEvents] = useState(totalEvents);

  // Calculate percentages using filtered data
  const hoursPercentage = goals.hours_goal > 0 ? Math.min(100, (filteredHours / goals.hours_goal) * 100) : 0;
  const eventsPercentage = goals.events_goal > 0 ? Math.min(100, (filteredEvents / goals.events_goal) * 100) : 0;

  // Function to filter data based on selected period
  const filterDataByPeriod = async (period: string, dateRange?: DateRange) => {
    try {
      const supabase = createClient();
      let startDate: Date | undefined;
      let endDate: Date | undefined;

      if (period === 'custom' && dateRange) {
        startDate = dateRange.from;
        endDate = dateRange.to;
      } else if (period !== 'lifetime') {
        const periods = getSemesterPeriods();
        const selectedPeriodData = periods[period as keyof typeof periods];
        startDate = selectedPeriodData.from;
        endDate = selectedPeriodData.to;
      }

      // If lifetime is selected, use all data
      if (period === 'lifetime') {
        setFilteredHours(totalHours);
        setFilteredEvents(totalEvents);
        return;
      }

      // Fetch filtered certificates based on date range
      let query = supabase
        .from('certificates')
        .select('event_start, event_end')
        .eq('user_id', userId);

      if (startDate) {
        query = query.gte('event_start', startDate.toISOString());
      }
      if (endDate) {
        query = query.lte('event_end', endDate.toISOString());
      }

      const { data: certificates, error } = await query;

      if (error) {
        console.error('Error filtering certificates:', error);
        return;
      }

      // Calculate filtered hours
      let totalFilteredHours = 0;
      if (certificates) {
        certificates.forEach((cert) => {
          const start = new Date(cert.event_start);
          const end = new Date(cert.event_end);
          const duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60); // Convert to hours
          totalFilteredHours += duration;
        });
      }

      setFilteredHours(totalFilteredHours);
      setFilteredEvents(certificates?.length || 0);

    } catch (error) {
      console.error('Error filtering data:', error);
      toast.error('Failed to filter data by date range');
    }
  };

  // Handle period selection
  const handlePeriodChange = (period: string) => {
    setSelectedPeriod(period);
    if (period !== 'custom') {
      setCustomDateRange(undefined);
      filterDataByPeriod(period);
    }
  };

  // Handle custom date range change
  const handleDateRangeChange = (dateRange: DateRange | undefined) => {
    setCustomDateRange(dateRange);
    if (dateRange && dateRange.from && dateRange.to) {
      filterDataByPeriod('custom', dateRange);
    }
  };

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
      {/* Date Range Selector */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Calendar className="h-4 w-4" />
          Goal Period
        </div>
        
        <div className="space-y-3">
          <Select value={selectedPeriod} onValueChange={handlePeriodChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select time period" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(getSemesterPeriods()).map(([key, period]) => (
                <SelectItem key={key} value={key}>
                  {period.label}
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom Date Range</SelectItem>
            </SelectContent>
          </Select>
          
          {selectedPeriod === 'custom' && (
            <DateRangePicker
              value={customDateRange}
              onChange={handleDateRangeChange}
              placeholder="Select custom date range"
              showQuickSelect={true}
            />
          )}
        </div>
        
        {selectedPeriod !== 'lifetime' && (
          <div className="text-xs text-muted-foreground">
            Showing progress for selected period only
          </div>
        )}
      </div>

      {/* Hours Goal */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="font-medium">Hours Goal</div>
          <div className="text-sm text-muted-foreground">
            {goals.hours_goal > 0
              ? // Use formatTotalDuration for both current and goal hours
                `${formatTotalDuration(Math.min(filteredHours, goals.hours_goal))} / ${formatTotalDuration(goals.hours_goal)} completed`
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
              ? `${Math.min(filteredEvents, goals.events_goal)}/${goals.events_goal} projects completed`
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
