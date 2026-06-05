export type RepeatType = 'allday' | 'once' | 'daily' | 'scheduled' | 'interval';

export type Habit = {
  id: string;
  icon: string;
  name: string;
  repeatType: RepeatType;
  time: string;
  alarm: boolean;
  date?: string;
  weekdays?: number[];
  showInToday?: boolean;
  createdAt: string;
  updatedAt: string;
};
