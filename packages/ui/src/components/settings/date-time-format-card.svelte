<script lang="ts">
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../card';
  import { Label } from '../label';
  import { Select, SelectContent, SelectItem, SelectTrigger } from '../select';
  import { Separator } from '../separator';
  import { Calendar, Clock } from '@lucide/svelte';

  interface FormatOption {
    value: string;
    label: string;
  }

  let {
    dateFormat,
    timeFormat,
    dateFormatOptions,
    timeFormatOptions,
    onDateFormatChange,
    onTimeFormatChange,
    disabled = false,
    labels = {
      title: 'Date & Time',
      description: 'Customize date and time display format',
      dateLabel: 'Date format',
      timeLabel: 'Time format',
      datePlaceholder: 'Select date format',
      timePlaceholder: 'Select time format'
    }
  } = $props<{
    dateFormat: string;
    timeFormat: string;
    dateFormatOptions: FormatOption[];
    timeFormatOptions: FormatOption[];
    onDateFormatChange: (value: string) => void;
    onTimeFormatChange: (value: string) => void;
    disabled?: boolean;
    labels?: {
      title: string;
      description: string;
      dateLabel: string;
      timeLabel: string;
      datePlaceholder: string;
      timePlaceholder: string;
    };
  }>();
</script>

<Card>
  <CardHeader>
    <CardTitle class="text-base">{labels.title}</CardTitle>
    <CardDescription>{labels.description}</CardDescription>
  </CardHeader>
  <CardContent class="space-y-4">
    <div class="space-y-2">
      <Label for="date-format" class="flex items-center gap-2">
        <Calendar class="h-4 w-4 text-muted-foreground" />
        {labels.dateLabel}
      </Label>
      <Select
        value={dateFormat}
        type="single"
        onValueChange={(value) => {
          if (value) onDateFormatChange(value);
        }}
        {disabled}
      >
        <SelectTrigger id="date-format" class="w-full">
          {dateFormatOptions.find((o: FormatOption) => o.value === dateFormat)?.label ??
            labels.datePlaceholder}
        </SelectTrigger>
        <SelectContent>
          {#each dateFormatOptions as option}
            <SelectItem value={option.value}>{option.label}</SelectItem>
          {/each}
        </SelectContent>
      </Select>
    </div>

    <Separator />

    <div class="space-y-2">
      <Label for="time-format" class="flex items-center gap-2">
        <Clock class="h-4 w-4 text-muted-foreground" />
        {labels.timeLabel}
      </Label>
      <Select
        value={timeFormat}
        type="single"
        onValueChange={(value) => {
          if (value) onTimeFormatChange(value);
        }}
        {disabled}
      >
        <SelectTrigger id="time-format" class="w-full">
          {timeFormatOptions.find((o: FormatOption) => o.value === timeFormat)?.label ??
            labels.timePlaceholder}
        </SelectTrigger>
        <SelectContent>
          {#each timeFormatOptions as option}
            <SelectItem value={option.value}>{option.label}</SelectItem>
          {/each}
        </SelectContent>
      </Select>
    </div>
  </CardContent>
</Card>
