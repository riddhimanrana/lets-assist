// Schedule.tsx - Handles scheduling step

"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar as CalendarIcon } from "lucide-react"
import { TimePicker } from "@/components/ui/time-picker"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

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
      multiDay: { date: string; slots: { startTime: string; endTime: string; volunteers: number }[] }[];
      multiRole: {
        date: string;
        overallStart: string;
        overallEnd: string;
        roles: { name: string; startTime: string; endTime: string; volunteers: number }[];
      };
    };
  },
  updateOneTimeScheduleAction: (field: keyof ScheduleProps["state"]["schedule"]["oneTime"], value: string | number) => void,
  updateMultiDayScheduleAction: (dayIndex: number, field: string, value: string, slotIndex?: number) => void,
  updateMultiRoleScheduleAction: (field: string, value: string | number, roleIndex?: number) => void,
  addMultiDaySlotAction: (dayIndex: number) => void,
  addMultiDayEventAction: () => void,
  addRoleAction: () => void,
  removeDayAction: (dayIndex: number) => void,
  removeSlotAction: (dayIndex: number, slotIndex: number) => void,
  removeRoleAction: (roleIndex: number) => void
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
  removeRoleAction
}: ScheduleProps) {

  const isTimeRangeInvalid = (startTime: string, endTime: string) => {
    if (!startTime || !endTime) return false;
    const [startHour, startMinute] = startTime.split(":").map(Number);
    const [endHour, endMinute] = endTime.split(":").map(Number);
    if (endHour < startHour) return true;
    if (endHour === startHour && endMinute <= startMinute) return true;
    return false;
  };

  if (state.eventType === 'oneTime') {
    const timeRangeInvalid = isTimeRangeInvalid(state.schedule.oneTime.startTime, state.schedule.oneTime.endTime);
    return (
      <Card>
        <CardHeader>
          <CardTitle>Schedule Your Event</CardTitle>
          <p className="text-sm text-muted-foreground">Pick a date and time for your event</p>
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
                        !state.schedule.oneTime.date && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {state.schedule.oneTime.date ? 
                        format(new Date(state.schedule.oneTime.date), "PPP") : 
                        "Pick a date"
                      }
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={state.schedule.oneTime.date ? new Date(state.schedule.oneTime.date) : undefined}
                      onSelect={(date) => 
                        updateOneTimeScheduleAction('date', date ? format(date, 'yyyy-MM-dd') : '')
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label>Volunteers Needed</Label>
                <Input 
                  type="number" 
                  min="1" 
                  className="mt-1.5"
                  value={state.schedule.oneTime.volunteers}
                  onChange={(e) => updateOneTimeScheduleAction('volunteers', parseInt(e.target.value))}
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <TimePicker
                label="Start Time"
                value={state.schedule.oneTime.startTime}
                onChangeAction={(time: string) => updateOneTimeScheduleAction('startTime', time)}
                error={timeRangeInvalid}
                errorMessage={timeRangeInvalid ? "Start time must be before end time" : undefined}
              />
              <TimePicker
                label="End Time"
                value={state.schedule.oneTime.endTime}
                onChangeAction={(time: string) => updateOneTimeScheduleAction('endTime', time)}
                error={timeRangeInvalid}
                errorMessage={timeRangeInvalid ? "End time must be after start time" : undefined}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.eventType === 'multiDay') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Schedule Your Event</CardTitle>
          <p className="text-sm text-muted-foreground">Set up your event schedule across multiple days</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {state.schedule.multiDay.map((day: { date: string, slots: { startTime: string, endTime: string, volunteers: number }[] }, dayIndex: number) => (
              <div key={dayIndex} className="p-4 border rounded-lg">
                <div className="flex items-center justify-between mb-4">
                  <Label className="text-base sm:text-lg font-medium">Day {dayIndex + 1}</Label>
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
                <div className="space-y-4">
                  <div>
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
                          {day.date ? 
                            format(new Date(day.date), "PPP") : 
                            "Pick a date"
                          }
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={day.date ? new Date(day.date) : undefined}
                          onSelect={(date) => 
                            updateMultiDayScheduleAction(dayIndex, 'date', date ? format(date, 'yyyy-MM-dd') : '')
                          }
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  {day.slots.map((slot: { startTime: string, endTime: string, volunteers: number }, slotIndex: number) => {
                    const timeRangeInvalid = isTimeRangeInvalid(slot.startTime, slot.endTime);
                    return (
                      <div key={slotIndex} className="p-4 bg-muted/50 rounded-lg space-y-4">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">Time Slot {slotIndex + 1}</Label>
                          {slotIndex > 0 && (
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={() => removeSlotAction(dayIndex, slotIndex)}
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
                              onChangeAction={(time: string) => updateMultiDayScheduleAction(dayIndex, 'startTime', time, slotIndex)}
                              error={timeRangeInvalid}
                              errorMessage={timeRangeInvalid ? "Invalid time" : undefined}
                            />
                            <TimePicker
                              value={slot.endTime}
                              onChangeAction={(time: string) => updateMultiDayScheduleAction(dayIndex, 'endTime', time, slotIndex)}
                              error={timeRangeInvalid}
                              errorMessage={timeRangeInvalid ? "Invalid time" : undefined}
                            />
                          </div>
                          <div>
                            <Label className="sr-only">Volunteers</Label>
                            <Input 
                              type="number" 
                              min="1" 
                              placeholder="# volunteers"
                              value={slot.volunteers}
                              onChange={(e) => updateMultiDayScheduleAction(dayIndex, 'volunteers', e.target.value, slotIndex)}
                              className="h-10"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
            ))}
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

  if (state.eventType === 'sameDayMultiArea') {
    const overallTimeInvalid = isTimeRangeInvalid(state.schedule.multiRole.overallStart, state.schedule.multiRole.overallEnd);
    return (
      <Card>
        <CardHeader>
          <CardTitle>Schedule Your Event</CardTitle>
          <p className="text-sm text-muted-foreground">Define different roles and timings for a single day event</p>
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
                        !state.schedule.multiRole.date && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {state.schedule.multiRole.date ? 
                        format(new Date(state.schedule.multiRole.date), "PPP") : 
                        "Pick a date"
                      }
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={state.schedule.multiRole.date ? new Date(state.schedule.multiRole.date) : undefined}
                      onSelect={(date) => 
                        updateMultiRoleScheduleAction('date', date ? format(date, 'yyyy-MM-dd') : '')
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label>Overall Event Hours</Label>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  <TimePicker
                    value={state.schedule.multiRole.overallStart}
                    onChangeAction={(time: string) => updateMultiRoleScheduleAction('overallStart', time)}
                    error={overallTimeInvalid}
                    errorMessage={overallTimeInvalid ? "Invalid time" : undefined}
                  />
                  <TimePicker
                    value={state.schedule.multiRole.overallEnd}
                    onChangeAction={(time: string) => updateMultiRoleScheduleAction('overallEnd', time)}
                    error={overallTimeInvalid}
                    errorMessage={overallTimeInvalid ? "Invalid time" : undefined}
                  />
                </div>
              </div>
            </div>
            {state.schedule.multiRole.roles.map((role: { name: string, startTime: string, endTime: string, volunteers: number }, roleIndex: number) => {
              const roleTimeInvalid = isTimeRangeInvalid(role.startTime, role.endTime);
              return (
                <div key={roleIndex} className="p-4 border rounded-lg space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-base sm:text-lg font-medium">Role {roleIndex + 1}</Label>
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
                          updateMultiRoleScheduleAction('name', e.target.value, roleIndex);
                        }
                      }}
                      maxLength={75}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label>Time Slot</Label>
                        <div className="grid grid-cols-2 gap-2 mt-1.5">
                          <TimePicker
                            value={role.startTime}
                            onChangeAction={(time: string) => updateMultiRoleScheduleAction('startTime', time, roleIndex)}
                            error={roleTimeInvalid}
                            errorMessage={roleTimeInvalid ? "Invalid time" : undefined}
                          />
                          <TimePicker
                            value={role.endTime}
                            onChangeAction={(time: string) => updateMultiRoleScheduleAction('endTime', time, roleIndex)}
                            error={roleTimeInvalid}
                            errorMessage={roleTimeInvalid ? "Invalid time" : undefined}
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Volunteers Needed</Label>
                        <Input 
                          type="number" 
                          min="1" 
                          className="mt-1.5"
                          value={role.volunteers}
                          onChange={(e) => updateMultiRoleScheduleAction('volunteers', parseInt(e.target.value), roleIndex)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
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
