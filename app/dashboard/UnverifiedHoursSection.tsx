"use client";

import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Calendar, 
  Building2, 
  User, 
  Search, 
  Trash2, 
  AlertTriangle,
  FileCheck,
  Plus,
  Clock
} from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AddVolunteerHoursModal } from "./AddVolunteerHoursModal";

// Mock data interface - will be replaced with actual data from database
interface UnverifiedHour {
  id: string;
  organizationName: string;
  date: string;
  startTime: string;
  endTime: string;
  supervisorContact?: string;
  description?: string;
  notes?: string;
  durationHours: number;
  createdAt: string;
}

interface UnverifiedHoursSectionProps {
  _userId?: string;
  unverifiedHours?: UnverifiedHour[];
  onAdd?: (data: unknown) => void;
  onDelete?: (id: string) => void;
}

// Mock data for development
const mockUnverifiedHours: UnverifiedHour[] = [
  {
    id: "1",
    organizationName: "Local Food Bank",
    date: "2024-01-15",
    startTime: "09:00",
    endTime: "13:00",
    supervisorContact: "Sarah Johnson - Volunteer Coordinator",
    description: "Helped sort and package food donations for local families",
    notes: "Great experience working with the team",
    durationHours: 4,
    createdAt: "2024-01-15T18:00:00Z"
  },
  {
    id: "2",
    organizationName: "Animal Shelter",
    date: "2024-01-10",
    startTime: "14:00",
    endTime: "16:30",
    supervisorContact: "Mike Chen",
    description: "Walked dogs and cleaned kennels",
    durationHours: 2.5,
    createdAt: "2024-01-10T20:00:00Z"
  },
  {
    id: "3",
    organizationName: "Community Library",
    date: "2024-01-08",
    startTime: "10:00",
    endTime: "12:00",
    description: "Helped with children's reading program",
    durationHours: 2,
    createdAt: "2024-01-08T15:00:00Z"
  }
];

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatTime12Hour(time24: string): string {
  const [hours, minutes] = time24.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

export function UnverifiedHoursSection({ 
  _userId, 
  unverifiedHours = mockUnverifiedHours, 
  onAdd, 
  onDelete 
}: UnverifiedHoursSectionProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredHours, setFilteredHours] = useState(unverifiedHours);

  // Filter hours based on search term
  React.useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredHours(unverifiedHours);
    } else {
      const filtered = unverifiedHours.filter(hour =>
        hour.organizationName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        hour.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        hour.supervisorContact?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredHours(filtered);
    }
  }, [searchTerm, unverifiedHours]);

  const totalHours = unverifiedHours.reduce((sum, hour) => sum + hour.durationHours, 0);
  const totalEntries = unverifiedHours.length;

  const handleDelete = (id: string) => {
    if (onDelete) {
      onDelete(id);
    }
    // For development, remove from local state
    setFilteredHours(prev => prev.filter(hour => hour.id !== id));
  };

  if (unverifiedHours.length === 0) {
    return (
      <div className="space-y-6">
        {/* Header with Add Button */}
        <div className="flex justify-end">
          <AddVolunteerHoursModal onAdd={onAdd} />
        </div>

        {/* Empty State */}
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileCheck className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-xl font-semibold mb-2">No entries yet</h3>
          <p className="text-muted-foreground max-w-md mb-6">
            Start tracking volunteer hours from activities outside of Let&apos;s Assist by adding your first entry.
          </p>
          <AddVolunteerHoursModal 
            onAdd={onAdd}
            trigger={
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Entry
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Add Button */}
      <div className="flex justify-between items-center">
        <div>
          <p className="text-sm text-muted-foreground">
            {totalEntries} {totalEntries === 1 ? 'entry' : 'entries'} • {formatDuration(totalHours)} total
          </p>
        </div>
        <AddVolunteerHoursModal onAdd={onAdd} />
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by organization, description, or supervisor..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Disclaimer Banner */}
      <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-amber-900 dark:text-amber-100">Self-Reported Hours Notice</h4>
              <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                These hours are self-reported and not verified by Let&apos;s Assist. They will be clearly 
                marked as unverified in all certificates and exports.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Hours List */}
      <div className="space-y-4">
        {filteredHours.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No matching entries found</h3>
              <p className="text-muted-foreground">
                Try adjusting your search terms or add a new entry.
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredHours.map((hour) => (
            <Card key={hour.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-6">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                  {/* Main Content */}
                  <div className="flex-1 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <h3 className="font-semibold text-lg flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        {hour.organizationName}
                      </h3>
                      <Badge variant="secondary" className="w-fit">
                        Self-Reported
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>{format(parseISO(hour.date), "MMM d, yyyy")}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span>{formatTime12Hour(hour.startTime)} - {formatTime12Hour(hour.endTime)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <FileCheck className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{formatDuration(hour.durationHours)}</span>
                      </div>
                    </div>

                    {hour.supervisorContact && (
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">Supervisor: {hour.supervisorContact}</span>
                      </div>
                    )}

                    {hour.description && (
                      <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                        {hour.description}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 lg:flex-col lg:items-end">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 text-destructive hover:text-destructive-foreground hover:bg-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Entry</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete this entry for {hour.organizationName}? 
                            This action cannot be undone and will remove {formatDuration(hour.durationHours)} from your records.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(hour.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete Entry
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
