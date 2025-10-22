"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
// import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarIcon, AlertCircle } from "lucide-react";
import { TimePicker } from "@/components/ui/time-picker";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ZodIssue } from "zod";
// import { VerificationMethod } from "@/types"

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
    field: keyof ScheduleProps["state"]["schedule"]["oneTime"],
    value: string | number,
  ) => void;
  updateMultiDayScheduleAction: (
    dayIndex: number,
    field: string,
    value: string | number,
    slotIndex?: number,
  ) => void;
  updateMultiRoleScheduleAction: (
    field: string,
    value: string | number,
    roleIndex?: number,
  ) => void;
  addMultiDaySlotAction: (dayIndex: number) => void;
  addMultiDayEventAction: () => void;
  addRoleAction: () => void;
  removeDayAction: (dayIndex: number) => void;
  removeSlotAction: (dayIndex: number, slotIndex: number) => void;
  removeRoleAction: (roleIndex: number) => void;
  errors?: ZodIssue[];
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
  errors = []
}: ScheduleProps) {
  // Helper function to ensure dates are handled consistently without timezone shifting
  const formatDateToString = (date: Date | undefined): string => {
    if (!date) return "";
    // Create new date with just the year, month, and day components to avoid timezone issues
    return format(new Date(date.getFullYear(), date.getMonth(), date.getDate()), "yyyy-MM-dd");
  };
  
  // Helper function to parse date string to Date object without timezone shifting
  const parseStringToDate = (dateString: string): Date | undefined => {
    if (!dateString) return undefined;
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day); // month is 0-indexed in JavaScript Date
  };

  const isTimeRangeInvalid = (startTime: string, endTime: string) => {
    if (!startTime || !endTime) return false;
    const [startHour, startMinute] = startTime.split(":").map(Number);
    const [endHour, endMinute] = endTime.split(":").map(Number);
    if (endHour < startHour) return true;
    if (endHour === startHour && endMinute <= startMinute) return true;
    return false;
  };

  // Add functions to validate dates and times
  const isPastDate = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  const isTimeInPast = (date: string, time: string) => {
    if (!date || !time) return false;
    
    const [hours, minutes] = time.split(':').map(Number);
    const selectedDate = parseStringToDate(date);
    if (!selectedDate) return false;
    
    const datetime = new Date(selectedDate);
    datetime.setHours(hours, minutes, 0, 0);
    
    return datetime < new Date();
  };

  // Get field error from Zod issues
  const getFieldError = (fieldPath: string): string | undefined => {
    const error = errors.find(issue => {
      return issue.path.join('.') === fieldPath ||
             issue.path.join('.').startsWith(fieldPath + '[') ||
             issue.path.join('.').startsWith(fieldPath + '.');
    });
    return error?.message;
  };

  // Get array error from Zod issues for nested structures (slots, roles)
  const getArrayError = (basePath: string, index: number, field: string): string | undefined => {
    const path = `${basePath}.${index}.${field}`;
    return getFieldError(path);
  };

  // For multi-day validation error display
  const getMultiDayError = (dayIndex: number): string | undefined => {
    return errors.find(issue => 
      issue.path[0] === dayIndex || 
      (Array.isArray(issue.path) && issue.path[0] === dayIndex)
    )?.message;
  };

  if (state.eventType === "oneTime") {
    const timeRangeInvalid = isTimeRangeInvalid(
      state.schedule.oneTime.startTime,
      state.schedule.oneTime.endTime,
    );

    // Get specific errors for oneTime fields
    const dateError = getFieldError('date');
    const startTimeError = getFieldError('startTime');
    const endTimeError = getFieldError('endTime');
    const volunteersError = getFieldError('volunteers');

    return (
      <Card>
        <CardHeader>
          <CardTitle>Schedule Your Event</CardTitle>
          <p className="text-sm text-muted-foreground">
            Pick a date and time for your event
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Event Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal mt-1.5",
                        !state.schedule.oneTime.date && "text-muted-foreground",
                        dateError && "border-destructive",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {state.schedule.oneTime.date
                        ? format(parseStringToDate(state.schedule.oneTime.date) as Date, "PPP")
                        : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={parseStringToDate(state.schedule.oneTime.date)}
                      onSelect={(date) => {
                        const newDate = formatDateToString(date);
                        if (newDate !== state.schedule.oneTime.date) {
                          updateOneTimeScheduleAction("date", newDate);
                        }
                      }}
                      disabled={isPastDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                {dateError && (
                  <div className="text-destructive text-sm flex items-center gap-2 mt-1">
                    <AlertCircle className="h-4 w-4" />
                    {dateError}
                  </div>
                )}
              </div>
              <div>
                <Label>Volunteers Needed</Label>
                <Input
                  type="number"
                  min="1"
                  max="1000"
                  placeholder="Enter number of volunteers"
                  className={cn(
                    "mt-1.5",
                    volunteersError && "border-destructive"
                  )}
                  value={state.schedule.oneTime.volunteers || ''}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    updateOneTimeScheduleAction(
                      "volunteers",
                      value
                    );
                  }}
                />
                {volunteersError && (
                  <div className="text-destructive text-sm flex items-center gap-2 mt-1">
                    <AlertCircle className="h-4 w-4" />
                    {volunteersError}
                  </div>
                )}
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <TimePicker
                label="Start Time"
                value={state.schedule.oneTime.startTime}
                onChangeAction={(time: string) =>
                  updateOneTimeScheduleAction("startTime", time)
                }
                error={timeRangeInvalid || isTimeInPast(state.schedule.oneTime.date, state.schedule.oneTime.startTime) || !!startTimeError}
                errorMessage={
                  startTimeError ? startTimeError :
                  timeRangeInvalid
                    ? "Start time must be before end time"
                    : isTimeInPast(state.schedule.oneTime.date, state.schedule.oneTime.startTime)
                    ? "Start time must be in the future"
                    : undefined
                }
              />
              <TimePicker
                label="End Time"
                value={state.schedule.oneTime.endTime}
                onChangeAction={(time: string) =>
                  updateOneTimeScheduleAction("endTime", time)
                }
                error={timeRangeInvalid || isTimeInPast(state.schedule.oneTime.date, state.schedule.oneTime.endTime) || !!endTimeError}
                errorMessage={
                  endTimeError ? endTimeError :
                  timeRangeInvalid
                    ? "End time must be after start time"
                    : isTimeInPast(state.schedule.oneTime.date, state.schedule.oneTime.endTime)
                    ? "End time must be in the future"
                    : undefined
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.eventType === "multiDay") {
    // Get general array error for multiDay
    const multiDayError = getFieldError('');

    return (
      <Card>
        <CardHeader>
          <CardTitle>Schedule Your Event</CardTitle>
          <p className="text-sm text-muted-foreground">
            Set up your event schedule across multiple days
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {multiDayError && (
              <div className="text-destructive text-sm flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-md">
                <AlertCircle className="h-4 w-4" />
                {multiDayError}
              </div>
            )}

            {state.schedule.multiDay.map(
              (
                day: {
                  date: string;
                  slots: {
                    startTime: string;
                    endTime: string;
                    volunteers: number;
                  }[];
                },
                dayIndex: number,
              ) => {
                // Get day-specific errors
                const dayError = getMultiDayError(dayIndex);
                const dateError = getFieldError(`${dayIndex}.date`);
                const slotsError = getFieldError(`${dayIndex}.slots`);

                return (
                  <div key={dayIndex} className={cn(
                    "p-4 border rounded-lg",
                    (dayError || dateError || slotsError) && "border-destructive bg-destructive/5"
                  )}>
                    <div className="flex items-center justify-between mb-4">
                      <Label className="text-base sm:text-lg font-medium">
                        Day {dayIndex + 1}
                      </Label>
                      {dayIndex > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeDayAction(dayIndex)}
                          className="h-8 w-8 hover:bg-muted/80"
                        >
                          ✕
                        </Button>
                      )}
                    </div>

                    {(dayError || dateError) && (
                      <div className="text-destructive text-sm flex items-center gap-2 mb-3">
                        <AlertCircle className="h-4 w-4" />
                        {dayError || dateError}
                      </div>
                    )}

                    <div className="space-y-4">
                      <div>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !day.date && "text-muted-foreground",
                                dateError && "border-destructive",
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {day.date
                                ? format(parseStringToDate(day.date) as Date, "PPP")
                                : "Pick a date"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={parseStringToDate(day.date)}
                              onSelect={(date) => {
                                const newDate = formatDateToString(date);
                                if (newDate !== day.date) {
                                  updateMultiDayScheduleAction(dayIndex, "date", newDate);
                                }
                              }}
                              disabled={isPastDate}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </div>

                      {slotsError && (
                        <div className="text-destructive text-sm flex items-center gap-2">
                          <AlertCircle className="h-4 w-4" />
                          {slotsError}
                        </div>
                      )}

                      {day.slots.map(
                        (
                          slot: {
                            startTime: string;
                            endTime: string;
                            volunteers: number;
                          },
                          slotIndex: number,
                        ) => {
                          const timeRangeInvalid = isTimeRangeInvalid(
                            slot.startTime,
                            slot.endTime,
                          );
                          
                          // Get slot-specific errors
                          const startTimeError = getArrayError(`${dayIndex}.slots`, slotIndex, 'startTime');
                          const endTimeError = getArrayError(`${dayIndex}.slots`, slotIndex, 'endTime');
                          const volunteersError = getArrayError(`${dayIndex}.slots`, slotIndex, 'volunteers');
                          
                          return (
                            <div
                              key={slotIndex}
                              className={cn(
                                "p-4 bg-muted/50 rounded-lg space-y-4",
                                (startTimeError || endTimeError || volunteersError) && "border border-destructive bg-destructive/5"
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium">
                                  Time Slot {slotIndex + 1}
                                </Label>
                                {slotIndex > 0 && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      removeSlotAction(dayIndex, slotIndex)
                                    }
                                    className="h-8 w-8 hover:bg-muted/80"
                                  >
                                    ✕
                                  </Button>
                                )}
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="col-span-1 sm:col-span-2 grid grid-cols-2 gap-2">
                                  <TimePicker
                                    value={slot.startTime}
                                    onChangeAction={(time: string) =>
                                      updateMultiDayScheduleAction(
                                        dayIndex,
                                        "startTime",
                                        time,
                                        slotIndex,
                                      )
                                    }
                                    error={timeRangeInvalid || isTimeInPast(day.date, slot.startTime) || !!startTimeError}
                                    errorMessage={
                                      startTimeError ? startTimeError :
                                      timeRangeInvalid
                                        ? "Invalid time"
                                        : isTimeInPast(day.date, slot.startTime)
                                        ? "Start time must be in the future"
                                        : undefined
                                    }
                                  />
                                  <TimePicker
                                    value={slot.endTime}
                                    onChangeAction={(time: string) =>
                                      updateMultiDayScheduleAction(
                                        dayIndex,
                                        "endTime",
                                        time,
                                        slotIndex,
                                      )
                                    }
                                    error={timeRangeInvalid || isTimeInPast(day.date, slot.endTime) || !!endTimeError}
                                    errorMessage={
                                      endTimeError ? endTimeError :
                                      timeRangeInvalid
                                        ? "Invalid time"
                                        : isTimeInPast(day.date, slot.endTime)
                                        ? "End time must be in the future"
                                        : undefined
                                    }
                                  />
                                </div>
                                <div>
                                  <Label className="sr-only">Volunteers</Label>
                                  <div>
                                    <Input
                                      type="number"
                                      min="1"
                                      max="1000"
                                      placeholder="# volunteers"
                                      value={slot.volunteers || ''}
                                      onChange={(e) => {
                                        const value = parseInt(e.target.value);
                                        updateMultiDayScheduleAction(
                                          dayIndex,
                                          "volunteers",
                                          value,
                                          slotIndex,
                                        );
                                      }}
                                      className={cn(
                                        "h-10",
                                        volunteersError && "border-destructive"
                                      )}
                                    />
                                    {volunteersError && (
                                      <div className="text-destructive text-sm flex items-center gap-2 mt-1">
                                        <AlertCircle className="h-4 w-4" />
                                        {volunteersError}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        },
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => addMultiDaySlotAction(dayIndex)}
                      >
                        + Add Time Slot
                      </Button>
                    </div>
                  </div>
                );
              }
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={addMultiDayEventAction}
            >
              + Add Another Day
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.eventType === "sameDayMultiArea") {
    // Get errors for sameDayMultiArea fields
    const dateError = getFieldError('date');
    const overallStartError = getFieldError('overallStart');
    const overallEndError = getFieldError('overallEnd');
    const rolesError = getFieldError('roles');

    return (
      <Card>
        <CardHeader>
          <CardTitle>Schedule Your Event</CardTitle>
          <p className="text-sm text-muted-foreground">
            Define different roles and timings for a single day event
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Event Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal mt-1.5",
                        !state.schedule.sameDayMultiArea.date &&
                          "text-muted-foreground",
                        dateError && "border-destructive"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {state.schedule.sameDayMultiArea.date
                        ? format(
                            parseStringToDate(state.schedule.sameDayMultiArea.date) as Date,
                            "PPP",
                          )
                        : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={parseStringToDate(state.schedule.sameDayMultiArea.date)}
                      onSelect={(date) => {
                        const newDate = formatDateToString(date);
                        if (newDate !== state.schedule.sameDayMultiArea.date) {
                          updateMultiRoleScheduleAction("date", newDate);
                        }
                      }}
                      disabled={isPastDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                {dateError && (
                  <div className="text-destructive text-sm flex items-center gap-2 mt-1">
                    <AlertCircle className="h-4 w-4" />
                    {dateError}
                  </div>
                )}
              </div>
              <div>
                <Label>Overall Event Hours (Auto-calculated)</Label>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  <TimePicker
                    value={state.schedule.sameDayMultiArea.overallStart}
                    onChangeAction={(time: string) =>
                      updateMultiRoleScheduleAction("overallStart", time)
                    }
                    error={!!overallStartError}
                    errorMessage={overallStartError}
                    disabled={true}
                  />
                  <TimePicker
                    value={state.schedule.sameDayMultiArea.overallEnd}
                    onChangeAction={(time: string) =>
                      updateMultiRoleScheduleAction("overallEnd", time)
                    }
                    error={!!overallEndError}
                    errorMessage={overallEndError}
                    disabled={true}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Overall times auto-adjust by earliest/latest role times.
                </p>
              </div>
            </div>

            {rolesError && (
              <div className="text-destructive text-sm flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-md">
                <AlertCircle className="h-4 w-4" />
                {rolesError}
              </div>
            )}

            {state.schedule.sameDayMultiArea.roles.map(
              (
                role: {
                  name: string;
                  startTime: string;
                  endTime: string;
                  volunteers: number;
                },
                roleIndex: number,
              ) => {
                const roleTimeInvalid = isTimeRangeInvalid(
                  role.startTime,
                  role.endTime,
                );
                
                // Get role-specific errors
                const nameError = getArrayError('roles', roleIndex, 'name');
                const startTimeError = getArrayError('roles', roleIndex, 'startTime');
                const endTimeError = getArrayError('roles', roleIndex, 'endTime');
                const volunteersError = getArrayError('roles', roleIndex, 'volunteers');
                const hasRoleErrors = nameError || startTimeError || endTimeError || volunteersError;

                return (
                  <div
                    key={roleIndex}
                    className={cn(
                      "p-4 border rounded-lg space-y-4",
                      hasRoleErrors && "border-destructive bg-destructive/5"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <Label className="text-base sm:text-lg font-medium">
                        Role {roleIndex + 1}
                      </Label>
                      {roleIndex > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeRoleAction(roleIndex)}
                          className="h-8 w-8 hover:bg-muted/80"
                        >
                          ✕
                        </Button>
                      )}
                    </div>
                    <div className="space-y-4">
                      <div className="flex justify-between items-baseline mb-1.5">
                        <Label>Role Name</Label>
                        <span className="text-xs">{role.name.length}/75</span>
                      </div>
                      <Input
                        placeholder="Role name (e.g., Event Decoration)"
                        value={role.name}
                        onChange={(e) => {
                          if (e.target.value.length <= 75) {
                            updateMultiRoleScheduleAction(
                              "name",
                              e.target.value,
                              roleIndex,
                            );
                          }
                        }}
                        maxLength={75}
                        className={nameError ? "border-destructive" : ""}
                      />
                      {nameError && (
                        <div className="text-destructive text-sm flex items-center gap-2 mt-1">
                          <AlertCircle className="h-4 w-4" />
                          {nameError}
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <Label>Time Slot</Label>
                          <div className="grid grid-cols-2 gap-2 mt-1.5">
                            <TimePicker
                              value={role.startTime}
                              onChangeAction={(time: string) =>
                                updateMultiRoleScheduleAction(
                                  "startTime",
                                  time,
                                  roleIndex,
                                )
                              }
                              error={roleTimeInvalid || isTimeInPast(state.schedule.sameDayMultiArea.date, role.startTime) || !!startTimeError}
                              errorMessage={
                                startTimeError ? startTimeError :
                                roleTimeInvalid 
                                  ? "Invalid time" 
                                  : isTimeInPast(state.schedule.sameDayMultiArea.date, role.startTime)
                                  ? "Start time must be in the future"
                                  : undefined
                              }
                            />
                            <TimePicker
                              value={role.endTime}
                              onChangeAction={(time: string) =>
                                updateMultiRoleScheduleAction(
                                  "endTime",
                                  time,
                                  roleIndex,
                                )
                              }
                              error={roleTimeInvalid || isTimeInPast(state.schedule.sameDayMultiArea.date, role.endTime) || !!endTimeError}
                              errorMessage={
                                endTimeError ? endTimeError :
                                roleTimeInvalid 
                                  ? "Invalid time" 
                                  : isTimeInPast(state.schedule.sameDayMultiArea.date, role.endTime)
                                  ? "End time must be in the future"
                                  : undefined
                              }
                            />
                          </div>
                        </div>
                        <div>
                          <Label>Volunteers Needed</Label>
                          <div>
                            <Input
                              type="number"
                              min="1"
                              max="1000"
                              placeholder="Enter number of volunteers"
                              className={cn(
                                "mt-1.5",
                                volunteersError && "border-destructive"
                              )}
                              value={role.volunteers || ''}
                              onChange={(e) => {
                                const value = parseInt(e.target.value);
                                updateMultiRoleScheduleAction(
                                  "volunteers",
                                  value,
                                  roleIndex,
                                );
                              }}
                            />
                            {volunteersError && (
                              <div className="text-destructive text-sm flex items-center gap-2 mt-1">
                                <AlertCircle className="h-4 w-4" />
                                {volunteersError}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              },
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={addRoleAction}
            >
              + Add Another Role
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
