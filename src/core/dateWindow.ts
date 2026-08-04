import type { Skill } from './types.js';

function getFirstDayOfMonth(
  year: number,
  month: number,
  targetDay: number,
): Date {
  const date = new Date(year, month, 1);
  const diff = (targetDay - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diff);
  return date;
}

function formatPST(date: Date, time: string): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  
  // Determine PST/PDT offset (simplified - PST is -08:00, PDT is -07:00)
  // PDT: Second Sunday in March to First Sunday in November
  const marchSecondSunday = getFirstDayOfMonth(year, 2, 0);
  marchSecondSunday.setDate(marchSecondSunday.getDate() + 7);
  
  const novFirstSunday = getFirstDayOfMonth(year, 10, 0);
  
  const isPDT = date >= marchSecondSunday && date < novFirstSunday;
  const offset = isPDT ? '-07:00' : '-08:00';
  
  return `${year}-${month}-${day}T${time}${offset}`;
}

export interface DateWindow {
  month: string;
  startPST: string;
  endPST: string;
}

export interface DateWindowParams {
  month: string;
}

export function computeDateWindow(monthInput: string): DateWindow {
  // Parse month input
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  
  const parts = monthInput.trim().toLowerCase().split(/\s+/);
  const monthName = parts[0];
  const year = parseInt(parts[1], 10);
  
  const monthIndex = months.indexOf(monthName);
  if (monthIndex === -1) {
    throw new Error(`Invalid month: ${monthName}`);
  }
  
  // Calculate previous month
  let prevMonthIndex = monthIndex - 1;
  let prevYear = year;
  if (prevMonthIndex < 0) {
    prevMonthIndex = 11;
    prevYear = year - 1;
  }
  
  // First Tuesday of previous month (day 2 = Tuesday)
  const startDate = getFirstDayOfMonth(prevYear, prevMonthIndex, 2);
  
  // First Sunday of current month (day 0 = Sunday)
  const endDate = getFirstDayOfMonth(year, monthIndex, 0);
  
  return {
    month: monthInput,
    startPST: formatPST(startDate, '00:00:00'),
    endPST: formatPST(endDate, '23:59:59')
  };
}

export const dateWindowSkill: Skill<DateWindowParams, DateWindow> = {
  name: 'computeDateWindow',
  description: 'Compute PST newsletter window for a given Month. Returns startPST (first Tuesday of previous month at 00:00) and endPST (first Sunday of current month at 23:59).',
  parameters: {
    type: 'object',
    properties: {
      month: {
        type: 'string',
        description: 'Month and year, e.g., "February 2026"'
      }
    },
    required: ['month']
  },
  execute: async ({ month }) => computeDateWindow(month),
};

export { formatPST, getFirstDayOfMonth };
