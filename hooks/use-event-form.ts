"use client";

import { useReducer, Reducer } from 'react';
import { EventType, VerificationMethod, ProjectVisibility } from '@/types';

// --- Helper Functions --- 

// Helper to convert HH:MM time string to minutes since midnight
const timeToMinutes = (timeStr: string): number => {
  if (!timeStr || !timeStr.includes(':')) return -1; // Return invalid value if format is wrong
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return -1;
  return hours * 60 + minutes;
};

// Helper to convert minutes since midnight back to HH:MM string
const minutesToTime = (minutes: number): string => {
  if (minutes < 0 || minutes >= 24 * 60) return "00:00"; // Handle invalid input
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

// Helper to calculate overall start/end times based on roles
const calculateOverallTimes = (roles: EventFormState['schedule']['sameDayMultiArea']['roles']) => {
  if (!roles || roles.length === 0) {
    return { overallStart: '09:00', overallEnd: '17:00' }; // Default if no roles
  }

  let minStart = Infinity;
  let maxEnd = -Infinity;

  roles.forEach(role => {
    const startMins = timeToMinutes(role.startTime);
    const endMins = timeToMinutes(role.endTime);

    if (startMins !== -1 && startMins < minStart) {
      minStart = startMins;
    }
    if (endMins !== -1 && endMins > maxEnd) {
      maxEnd = endMins;
    }
  });

  // If no valid times found, return default
  if (minStart === Infinity || maxEnd === -Infinity) {
    return { overallStart: '09:00', overallEnd: '17:00' };
  }

  return {
    overallStart: minutesToTime(minStart),
    overallEnd: minutesToTime(maxEnd),
  };
};

// --- State Interface and Action Types --- 

export interface EventFormState {
  step: number;
  eventType: EventType;
  basicInfo: {
    title: string;
    location: string;
    locationData?: any;
    description: string;
    organizationId: string | null;
    projectTimezone?: string;
  };
  schedule: {
    oneTime: {
      date: string;
      startTime: string;
      endTime: string;
      volunteers: number;
    };
    multiDay: {
      date: string;
      slots: {
        startTime: string;
        endTime: string;
        volunteers: number;
      }[];
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
  verificationMethod: VerificationMethod;
  requireLogin: boolean;
  visibility: ProjectVisibility;
  restrictToOrgDomains: boolean;
}

type EventFormAction =
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'SET_EVENT_TYPE'; payload: EventType }
  | { type: 'UPDATE_BASIC_INFO'; payload: { field: string; value: any } }
  | { type: 'UPDATE_ONE_TIME_SCHEDULE'; payload: { field: string; value: any } }
  | {
    type: 'UPDATE_MULTI_DAY_SCHEDULE';
    payload: { dayIndex: number; field: string; value: any; slotIndex?: number };
  }
  | {
    type: 'UPDATE_MULTI_ROLE_SCHEDULE';
    payload: { field: string; value: any; roleIndex?: number };
  }
  | { type: 'ADD_MULTI_DAY_SLOT'; payload: { dayIndex: number } }
  | { type: 'ADD_MULTI_DAY_EVENT' }
  | { type: 'ADD_ROLE' }
  | { type: 'UPDATE_VERIFICATION_METHOD'; payload: VerificationMethod }
  | { type: 'UPDATE_REQUIRE_LOGIN'; payload: boolean }
  | { type: 'UPDATE_VISIBILITY'; payload: ProjectVisibility }
  | { type: 'UPDATE_RESTRICT_TO_ORG_DOMAINS'; payload: boolean }
  | { type: 'REMOVE_DAY'; payload: { dayIndex: number } }
  | { type: 'REMOVE_SLOT'; payload: { dayIndex: number; slotIndex: number } }
  | { type: 'REMOVE_ROLE'; payload: { roleIndex: number } };

const defaultMultiRoleEvent = {
  name: '',
  startTime: '14:00',
  endTime: '16:00',
  volunteers: 0,
};

const defaultMultiDaySlot = {
  startTime: '09:00',
  endTime: '17:00',
  volunteers: 0,
};

const initialState: EventFormState = {
  step: 1,
  eventType: 'oneTime',
  basicInfo: {
    title: '',
    location: '',
    locationData: undefined,
    description: '',
    organizationId: undefined as unknown as string | null,
  },
  schedule: {
    oneTime: {
      date: '',
      startTime: '09:00',
      endTime: '17:00',
      volunteers: 0,
    },
    multiDay: [
      {
        date: '',
        slots: [
          {
            startTime: '09:00',
            endTime: '17:00',
            volunteers: 0,
          },
        ],
      },
    ],
    sameDayMultiArea: {
      date: '',
      overallStart: '09:00',
      overallEnd: '17:00',
      roles: [
        {
          name: '',
          startTime: '09:00',
          endTime: '17:00',
          volunteers: 0,
        },
      ],
    },
  },
  verificationMethod: 'qr-code',
  requireLogin: true,
  visibility: 'public',
  restrictToOrgDomains: false,
};

const eventFormReducer: Reducer<EventFormState, EventFormAction> = (
  state,
  action,
) => {
  switch (action.type) {
    case 'NEXT_STEP':
      return {
        ...state,
        step: state.step + 1,
      };
    case 'PREV_STEP':
      return {
        ...state,
        step: state.step - 1,
      };
    case 'SET_EVENT_TYPE':
      return {
        ...state,
        eventType: action.payload,
      };
    case 'UPDATE_BASIC_INFO':
      return {
        ...state,
        basicInfo: {
          ...state.basicInfo,
          [action.payload.field]: action.payload.value,
        },
      };
    case 'UPDATE_ONE_TIME_SCHEDULE':
      return {
        ...state,
        schedule: {
          ...state.schedule,
          oneTime: {
            ...state.schedule.oneTime,
            [action.payload.field]: action.payload.value,
          },
        },
      };
    case 'UPDATE_MULTI_DAY_SCHEDULE': {
      const { dayIndex, field, value, slotIndex } = action.payload;
      const updatedMultiDay = [...state.schedule.multiDay];

      // Deep clone to avoid mutation
      const updatedDay = { ...updatedMultiDay[dayIndex] };

      if (slotIndex !== undefined) {
        // Update a slot field
        const updatedSlots = [...updatedDay.slots];
        updatedSlots[slotIndex] = {
          ...updatedSlots[slotIndex],
          [field]: value,
        };
        updatedDay.slots = updatedSlots;
      } else {
        // Update a day field directly
        updatedDay[field as keyof typeof updatedDay] = value;
      }

      updatedMultiDay[dayIndex] = updatedDay;

      return {
        ...state,
        schedule: {
          ...state.schedule,
          multiDay: updatedMultiDay,
        },
      };
    }
    case 'UPDATE_MULTI_ROLE_SCHEDULE': {
      const { field, value, roleIndex } = action.payload;
      let updatedRoles = [...state.schedule.sameDayMultiArea.roles];
      let updatedSameDayMultiArea = { ...state.schedule.sameDayMultiArea };

      if (roleIndex !== undefined) {
        // Update a specific role
        updatedRoles[roleIndex] = {
          ...updatedRoles[roleIndex],
          [field]: value,
        };
        updatedSameDayMultiArea.roles = updatedRoles;

        // Recalculate overall times if a role's time changed
        if (field === 'startTime' || field === 'endTime') {
          const { overallStart, overallEnd } = calculateOverallTimes(updatedRoles);
          updatedSameDayMultiArea.overallStart = overallStart;
          updatedSameDayMultiArea.overallEnd = overallEnd;
        }
      } else {
        // Update a day-level field (like overallStart, overallEnd, date)
        updatedSameDayMultiArea = {
          ...updatedSameDayMultiArea,
          [field]: value,
        };
      }

      return {
        ...state,
        schedule: {
          ...state.schedule,
          sameDayMultiArea: updatedSameDayMultiArea,
        },
      };
    }
    case 'ADD_MULTI_DAY_SLOT': {
      const { dayIndex } = action.payload;
      const updatedMultiDay = [...state.schedule.multiDay];
      // Deep clone day to avoid mutation
      const updatedDay = { ...updatedMultiDay[dayIndex] };
      // Add a new slot to this day
      updatedDay.slots = [...updatedDay.slots, { ...defaultMultiDaySlot }];
      // Update the day in the array
      updatedMultiDay[dayIndex] = updatedDay;

      return {
        ...state,
        schedule: {
          ...state.schedule,
          multiDay: updatedMultiDay,
        },
      };
    }
    case 'ADD_MULTI_DAY_EVENT': {
      return {
        ...state,
        schedule: {
          ...state.schedule,
          multiDay: [
            ...state.schedule.multiDay,
            {
              date: '',
              slots: [{ ...defaultMultiDaySlot }],
            },
          ],
        },
      };
    }
    case 'ADD_ROLE': {
      const updatedRoles = [
        ...state.schedule.sameDayMultiArea.roles,
        { ...defaultMultiRoleEvent },
      ];
      // Recalculate overall times after adding a role
      const { overallStart, overallEnd } = calculateOverallTimes(updatedRoles);

      return {
        ...state,
        schedule: {
          ...state.schedule,
          sameDayMultiArea: {
            ...state.schedule.sameDayMultiArea,
            roles: updatedRoles,
            overallStart, // Update overall times
            overallEnd,   // Update overall times
          },
        },
      };
    }
    case 'UPDATE_VERIFICATION_METHOD': {
      return {
        ...state,
        verificationMethod: action.payload,
      };
    }
    case 'UPDATE_REQUIRE_LOGIN': {
      return {
        ...state,
        requireLogin: action.payload,
      };
    }
    case 'UPDATE_VISIBILITY': {
      return {
        ...state,
        visibility: action.payload,
      };
    }
    case 'UPDATE_RESTRICT_TO_ORG_DOMAINS': {
      return {
        ...state,
        restrictToOrgDomains: action.payload,
      };
    }
    case 'REMOVE_DAY': {
      const { dayIndex } = action.payload;
      // Make a copy of the multi-day array
      const updatedMultiDay = [...state.schedule.multiDay];
      // Remove the day at the specified index
      updatedMultiDay.splice(dayIndex, 1);

      return {
        ...state,
        schedule: {
          ...state.schedule,
          multiDay: updatedMultiDay,
        },
      };
    }
    case 'REMOVE_SLOT': {
      const { dayIndex, slotIndex } = action.payload;
      // Make a deep copy to avoid mutations
      const updatedMultiDay = [...state.schedule.multiDay];
      const updatedDay = { ...updatedMultiDay[dayIndex] };
      const updatedSlots = [...updatedDay.slots];

      // Remove the slot at the specified index
      updatedSlots.splice(slotIndex, 1);
      updatedDay.slots = updatedSlots;
      updatedMultiDay[dayIndex] = updatedDay;

      return {
        ...state,
        schedule: {
          ...state.schedule,
          multiDay: updatedMultiDay,
        },
      };
    }
    case 'REMOVE_ROLE': {
      const { roleIndex } = action.payload;
      const updatedRoles = [...state.schedule.sameDayMultiArea.roles];
      updatedRoles.splice(roleIndex, 1);

      // Recalculate overall times after removing a role
      const { overallStart, overallEnd } = calculateOverallTimes(updatedRoles);

      return {
        ...state,
        schedule: {
          ...state.schedule,
          sameDayMultiArea: {
            ...state.schedule.sameDayMultiArea,
            roles: updatedRoles,
            overallStart, // Update overall times
            overallEnd,   // Update overall times
          },
        },
      };
    }
    default:
      return state;
  }
};

// --- Hook Export --- 

export const useEventForm = () => {
  const [state, dispatch] = useReducer(eventFormReducer, initialState);

  const nextStep = () => dispatch({ type: 'NEXT_STEP' });
  const prevStep = () => dispatch({ type: 'PREV_STEP' });

  const setEventType = (eventType: EventType) =>
    dispatch({ type: 'SET_EVENT_TYPE', payload: eventType });

  const updateBasicInfo = (field: string, value: any) =>
    dispatch({ type: 'UPDATE_BASIC_INFO', payload: { field, value } });

  const updateOneTimeSchedule = (field: string, value: any) =>
    dispatch({ type: 'UPDATE_ONE_TIME_SCHEDULE', payload: { field, value } });

  const updateMultiDaySchedule = (
    dayIndex: number,
    field: string,
    value: any,
    slotIndex?: number,
  ) =>
    dispatch({
      type: 'UPDATE_MULTI_DAY_SCHEDULE',
      payload: { dayIndex, field, value, slotIndex },
    });

  const updateMultiRoleSchedule = (
    field: string,
    value: any,
    roleIndex?: number,
  ) =>
    dispatch({
      type: 'UPDATE_MULTI_ROLE_SCHEDULE',
      payload: { field, value, roleIndex },
    });

  const addMultiDaySlot = (dayIndex: number) =>
    dispatch({ type: 'ADD_MULTI_DAY_SLOT', payload: { dayIndex } });

  const addMultiDayEvent = () => dispatch({ type: 'ADD_MULTI_DAY_EVENT' });

  const addRole = () => dispatch({ type: 'ADD_ROLE' });

  const updateVerificationMethod = (method: VerificationMethod) =>
    dispatch({ type: 'UPDATE_VERIFICATION_METHOD', payload: method });

  const updateRequireLogin = (requireLogin: boolean) =>
    dispatch({ type: 'UPDATE_REQUIRE_LOGIN', payload: requireLogin });

  const updateVisibility = (visibility: ProjectVisibility) =>
    dispatch({ type: 'UPDATE_VISIBILITY', payload: visibility });

  const updateRestrictToOrgDomains = (restrict: boolean) =>
    dispatch({ type: 'UPDATE_RESTRICT_TO_ORG_DOMAINS', payload: restrict });

  const removeDay = (dayIndex: number) =>
    dispatch({ type: 'REMOVE_DAY', payload: { dayIndex } });

  const removeSlot = (dayIndex: number, slotIndex: number) =>
    dispatch({ type: 'REMOVE_SLOT', payload: { dayIndex, slotIndex } });

  const removeRole = (roleIndex: number) =>
    dispatch({ type: 'REMOVE_ROLE', payload: { roleIndex } });

  return {
    state,
    nextStep,
    prevStep,
    setEventType,
    updateBasicInfo,
    updateOneTimeSchedule,
    updateMultiDaySchedule,
    updateMultiRoleSchedule,
    addMultiDaySlot,
    addMultiDayEvent,
    addRole,
    updateVerificationMethod,
    updateRequireLogin,
    updateVisibility,
    updateRestrictToOrgDomains,
    removeDay,
    removeSlot,
    removeRole,
  };
};
