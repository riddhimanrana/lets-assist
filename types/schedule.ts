// Schedule-related types for projects

interface BaseScheduleSlot {
  startTime: string;
  endTime: string;
  volunteers: number;
}

export interface OneTimeSchedule extends BaseScheduleSlot {
  date: string;
}

export interface MultiDaySlot extends BaseScheduleSlot {}

export interface MultiDayScheduleDay {
  date: string;
  slots: MultiDaySlot[];
}

export interface SameDayMultiAreaRole extends BaseScheduleSlot {
  name: string;
}

export interface SameDayMultiAreaSchedule {
  date: string;
  overallStart: string;
  overallEnd: string;
  roles: SameDayMultiAreaRole[];
}

export interface ProjectSchedule {
  oneTime?: OneTimeSchedule;
  multiDay?: MultiDayScheduleDay[];
  sameDayMultiArea?: SameDayMultiAreaSchedule;
}
