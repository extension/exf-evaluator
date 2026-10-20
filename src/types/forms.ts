export type FieldType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'email'
  | 'url'
  | 'date'
  | 'file_upload'
  | 'single_choice'
  | 'multiple_choice'
  | 'dropdown'
  | 'image_choice'
  | 'rating'
  | 'likert_scale'
  | 'nps'
  | 'slider'
  | 'matrix'
  | 'section_header'
  | 'page_break'
  | 'spacer'
  | 'instructional_text'
  | 'hidden_field'
  | 'calculated_field'
  | 'signature'

export type LogicOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'greater_than'
  | 'less_than'
  | 'is_empty'
  | 'is_not_empty'

export interface LogicCondition {
  fieldId: string
  operator: LogicOperator
  value?: string | number
}

export interface LogicRule {
  action: 'show' | 'hide' | 'skip_to_page'
  targetPageId?: string
  combinator: 'and' | 'or'
  conditions: LogicCondition[]
}

export interface FieldOption {
  id: string
  label: string
  value: string
  imageUrl?: string
}

export interface MatrixRow {
  id: string
  label: string
}

export interface MatrixColumn {
  id: string
  label: string
}

export interface FormField {
  id: string
  type: FieldType
  label: string
  placeholder?: string
  helpText?: string
  required: boolean
  hidden: boolean
  logic?: LogicRule[]
  options?: FieldOption[]       // for choice fields
  matrixRows?: MatrixRow[]      // for matrix
  matrixColumns?: MatrixColumn[] // for matrix
  matrixType?: 'radio' | 'checkbox'
  min?: number                  // for rating/slider/number
  max?: number
  step?: number
  formula?: string              // for calculated_field
  metadataKey?: string          // for hidden_field (maps to token metadata)
  scale?: number                // for likert/nps
  scaleLabels?: { start?: string; end?: string }
  content?: string              // for section_header / instructional_text
  acceptedFileTypes?: string[]  // for file_upload
  maxFileSizeMb?: number
}

export interface FormPage {
  id: string
  title: string
  fields: FormField[]
}

export interface FormSchema {
  pages: FormPage[]
}

export type SheetColumnType = 'text' | 'number' | 'date' | 'dropdown'

export interface SheetColumn {
  id: string
  label: string
  type: SheetColumnType
  options?: string[]
  required?: boolean
}

export interface SheetSchema {
  columns: SheetColumn[]
}

export type PeriodType = 'month' | 'quarter'

export interface FormSettings {
  maxSubmissions?: number
  onePerEmail?: boolean
  opensAt?: string
  closesAt?: string
  tokenExpiryDays?: number
  redirectUrl?: string
  notificationEmails?: string[]
  allowRespondentView?: boolean
  customCss?: string
  confirmationMessage?: string
  // Reporting period — used for impact dashboard grouping
  periodType?: PeriodType       // 'month' | 'quarter'
  periodValue?: string          // 'YYYY-MM' for month, free-text label for quarter
  periodStart?: string          // ISO date: actual start of the reporting period
  periodEnd?: string            // ISO date: actual end of the reporting period
  // Whether this is a regular form or a spreadsheet-style data collector
  formType?: 'form' | 'spreadsheet'
  // Folder grouping on the forms list
  folder?: string
  // Tab grouping on the forms list (e.g. "Q1", "Q2", "End of Year")
  tab?: string
  // Auto-reminder configuration
  reminderIntervalDays?: number   // days between auto-reminders
  reminderMaxCount?: number       // max auto-reminders to send per token
}

// Report content types
export type ReportSectionType =
  | 'overview'
  | 'kpi_snapshot'
  | 'ai_summary'
  | 'chart'
  | 'custom_text'
  | 'table'
  | 'quote_callout'

export interface ReportSection {
  id: string
  type: ReportSectionType
  title: string
  content?: string          // rich text / generated text
  formId?: string           // for ai_summary, table, chart sections
  chartType?: 'line' | 'bar' | 'pie' | 'heatmap'
  dateFrom?: string
  dateTo?: string
  order: number
}

export interface ReportContent {
  sections: ReportSection[]
}
