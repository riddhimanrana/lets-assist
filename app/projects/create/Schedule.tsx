"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CalendarIcon,
  Clock,
  Plus,
  Trash2,
  ChevronDown,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface ScheduleProps {
  state: {
    eventType: string;
    schedule: {
      oneTime: {
        date: string;
        startTime: string;
        endTime: string;
        volunteers: number;
      };
      multiDay: {
        date: string;
        slots: { startTime: string; endTime: string; volunteers: number }[];
      }[];
      sameDayMultiArea: {
        date: string;
        overallStart: string;
        overallEnd: string;
        roles: {
          name: string;
          startTime: string;
          endTime: string;
          volunteers: number;
        }[];
      };
    };
  };
  updateOneTimeScheduleAction: (
    field: "date" | "startTime" | "endTime" | "volunteers",
    value: string | number
  ) => void;
  updateMultiDayScheduleAction: (
    dayIndex: number,
    slotIndex: number,
    field: "date" | "startTime" | "endTime" | "volunteers",
    value: string | number
  ) => void;
  updateMultiRoleScheduleAction: (
    field: "date" | "overallStart" | "overallEnd" | string,
    roleIndex?: number,
    subfield?: string,
    value?: string | number
  ) => void;
  addMultiDaySlotAction: (dayIndex: number) => void;
  addMultiDayEventAction: () => void;
  addRoleAction: () => void;
  removeDayAction: (dayIndex: number) => void;
  removeSlotAction: (dayIndex: number, slotIndex: number) => void;
  removeRoleAction: (roleIndex: number) => void;
}

export default function Schedule({
  state,
  updateOneTimeScheduleAction,
  updateMultiDayScheduleAction,
  updateMultiRoleScheduleAction,
  addMultiDaySlotAction,
  addMultiDayEventAction,
  addRoleAction,
  removeDayAction,
  removeSlotAction,
  removeRoleAction,
}: ScheduleProps) {
  const [date, setDate] = useState<Date>();

  const handleDateSelect = (
    selectedDate: Date | undefined,
    updateFn: (field: "date" | "startTime" | "endTime" | "volunteers", value: string | number) => void
  ) => {
    if (!selectedDate) return;
    setDate(selectedDate);
    const formattedDate = format(selectedDate, "yyyy-MM-dd");
    updateFn("date", formattedDate);
  };

  const renderOneTimeSchedule = () => (
    <div className="space-y-6">
      {/* Date Selection */}
      <div className="space-y-2">
        <Label>Event Date</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !state.schedule.oneTime.date && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {state.schedule.oneTime.date ? (
                format(new Date(state.schedule.oneTime.date), "PPP")
              ) : (
                <span>Select a date</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={
                state.schedule.oneTime.date
                  ? new Date(state.schedule.oneTime.date)
                  : undefined
              }
              onSelect={(date) =>
                handleDateSelect(date, updateOneTimeScheduleAction)
              }
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Time Selection */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Start Time</Label>
          <div className="flex items-center">
            <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
            <Input
              type="time"
              value={state.schedule.oneTime.startTime}
              onChange={(e) =>
                updateOneTimeScheduleAction("startTime", e.target.value)
              }
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>End Time</Label>
          <div className="flex items-center">
            <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
            <Input
              type="time"
              value={state.schedule.oneTime.endTime}
              onChange={(e) =>
                updateOneTimeScheduleAction("endTime", e.target.value)
              }
            />
          </div>
        </div>
      </div>

      {/* Volunteer Count */}
      <div className="space-y-2">
        <Label>Number of Volunteers Needed</Label>
        <div className="flex items-center">
          <Users className="mr-2 h-4 w-4 text-muted-foreground" />
          <Input
            type="number"
            min="1"
            value={state.schedule.oneTime.volunteers}
            onChange={(e) =>
              updateOneTimeScheduleAction(
                "volunteers",
                parseInt(e.target.value, 10) || 1
              )
            }
          />
        </div>
      </div>
    </div>
  );

  const renderMultiDaySchedule = () => (
    <div className="space-y-6">
      <Accordion type="multiple" className="w-full" defaultValue={['day-0']}>
        {state.schedule.multiDay.map((day, dayIndex) => (
          <AccordionItem value={`day-${dayIndex}`} key={dayIndex} className="border-b">
            <div className="flex items-center justify-between">
              <AccordionTrigger className="flex-1">
                <div className="flex items-center gap-2 text-left">
                  <span className="font-medium">
                    Day {dayIndex + 1}: 
                    {day.date
                      ? format(new Date(day.date), " MMMM d, yyyy")
                      : " Select a date"}
                  </span>
                </div>
              </AccordionTrigger>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 mr-2"
                onClick={(e) => {
                  e.stopPropagation();
                  removeDayAction(dayIndex);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <AccordionContent>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !day.date && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {day.date ? (
                          format(new Date(day.date), "PPP")
                        ) : (
                          <span>Select a date</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={day.date ? new Date(day.date) : undefined}
                        onSelect={(date) => {
                          if (!date) return;
                          updateMultiDayScheduleAction(
                            dayIndex,
                            0,
                            "date",
                            format(date, "yyyy-MM-dd")
                          );
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-4">
                  <Label className="block mb-2">Time Slots</Label>
                  {day.slots.map((slot, slotIndex) => (
                    <div
                      key={slotIndex}
                      className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center border-l-2 border-muted pl-4 py-2"
                    >
                      <div className="space-y-1">
                        <Label className="text-xs">Start Time</Label>
                        <div className="flex items-center">
                          <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                          <Input
                            type="time"
                            value={slot.startTime}
                            onChange={(e) =>
                              updateMultiDayScheduleAction(
                                dayIndex,
                                slotIndex,
                                "startTime",
                                e.target.value
                              )
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">End Time</Label>
                        <div className="flex items-center">
                          <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                          <Input
                            type="time"
                            value={slot.endTime}
                            onChange={(e) =>
                              updateMultiDayScheduleAction(
                                dayIndex,
                                slotIndex,
                                "endTime",
                                e.target.value
                              )
                            }
                          />
                        </div>
                      </div>
                      <div className="flex items-end gap-2">
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">Volunteers</Label>
                          <div className="flex items-center">
                            <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                            <Input
                              type="number"
                              min="1"
                              value={slot.volunteers}
                              onChange={(e) =>
                                updateMultiDayScheduleAction(
                                  dayIndex,
                                  slotIndex,
                                  "volunteers",
                                  parseInt(e.target.value, 10) || 1
                                )
                              }
                            />
                          </div>
                        </div>

                        {slotIndex > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="mb-1"
                            onClick={() =>
                              removeSlotAction(dayIndex, slotIndex)
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}

                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => addMultiDaySlotAction(dayIndex)}
                  >
                    <Plus className="mr-1 h-4 w-4" /> Add Time Slot
                  </Button>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <Button
        variant="outline" 
        onClick={addMultiDayEventAction}
        className="w-full"
      >
        <Plus className="mr-2 h-4 w-4" /> Add Another Day
      </Button>
    </div>
  );

  const renderMultiRoleSchedule = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Event Date</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !state.schedule.sameDayMultiArea.date && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {state.schedule.sameDayMultiArea.date ? (
                format(new Date(state.schedule.sameDayMultiArea.date), "PPP")
              ) : (
                <span>Select a date</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            <Calendar
              mode="single"
              selected={
                state.schedule.sameDayMultiArea.date
                  ? new Date(state.schedule.sameDayMultiArea.date)
                  : undefined
              }
              onSelect={(date) => {
                if (!date) return;
                updateMultiRoleScheduleAction(
                  "date",
                  undefined,
                  undefined,
                  format(date, "yyyy-MM-dd")
                );
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Overall Start Time</Label>
          <div className="flex items-center">
            <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
            <Input
              type="time"
              value={state.schedule.sameDayMultiArea.overallStart}
              onChange={(e) =>
                updateMultiRoleScheduleAction(
                  "overallStart",
                  undefined,
                  undefined,
                  e.target.value
                )
              }
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Overall End Time</Label>
          <div className="flex items-center">
            <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
            <Input
              type="time"
              value={state.schedule.sameDayMultiArea.overallEnd}
              onChange={(e) =>
                updateMultiRoleScheduleAction(
                  "overallEnd",
                  undefined,
                  undefined,
                  e.target.value
                )
              }
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>Volunteer Roles</Label>
        </div>

        <Accordion type="multiple" className="w-full" defaultValue={['role-0']}>
          {state.schedule.sameDayMultiArea.roles.map((role, roleIndex) => (
            <AccordionItem value={`role-${roleIndex}`} key={roleIndex}>
              <div className="flex items-center justify-between">
                <AccordionTrigger className="flex-1">
                  {role.name || `Role ${roleIndex + 1}`}
                </AccordionTrigger>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 mr-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRoleAction(roleIndex);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <AccordionContent>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>Role Name</Label>
                    <Input
                      placeholder="e.g., Greeter, Food Server, Setup Crew"
                      value={role.name}
                      onChange={(e) =>
                        updateMultiRoleScheduleAction(
                          `roles[${roleIndex}].name`,
                          roleIndex,
                          "name",
                          e.target.value
                        )
                      }
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Time</Label>
                      <div className="flex items-center">
                        <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="time"
                          value={role.startTime}
                          onChange={(e) =>
                            updateMultiRoleScheduleAction(
                              `roles[${roleIndex}].startTime`,
                              roleIndex,
                              "startTime",
                              e.target.value
                            )
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>End Time</Label>
                      <div className="flex items-center">
                        <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="time"
                          value={role.endTime}
                          onChange={(e) =>
                            updateMultiRoleScheduleAction(
                              `roles[${roleIndex}].endTime`,
                              roleIndex,
                              "endTime",
                              e.target.value
                            )
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Volunteers Needed</Label>
                    <div className="flex items-center">
                      <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="number"
                        min="1"
                        value={role.volunteers}
                        onChange={(e) =>
                          updateMultiRoleScheduleAction(
                            `roles[${roleIndex}].volunteers`,
                            roleIndex,
                            "volunteers",
                            parseInt(e.target.value, 10) || 1
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <Button variant="outline" onClick={addRoleAction} className="w-full">
          <Plus className="mr-2 h-4 w-4" /> Add Another Role
        </Button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Volunteer Schedule</CardTitle>
        <p className="text-sm text-muted-foreground">
          {state.eventType === "oneTime" && "Set up the date and time for your one-time event"}
          {state.eventType === "multiDay" && "Configure multiple days and time slots"}
          {state.eventType === "sameDayMultiArea" && "Set up different volunteer roles for your event"}
        </p>
      </CardHeader>
      <CardContent>
        {state.eventType === "oneTime" && renderOneTimeSchedule()}
        {state.eventType === "multiDay" && renderMultiDaySchedule()}
        {state.eventType === "sameDayMultiArea" && renderMultiRoleSchedule()}
      </CardContent>
    </Card>
  );
}
