export type SegmentMasterItem = {
  id?: string
  code: string
  label: string
  active?: boolean
}

export const DEFAULT_CUSTOMER_CATEGORIES: string[] = [
  'PCOS Support',
  'Fibroid Support',
  'Diabetes Support',
  'Hypertension Support',
  'Weight Management',
  'Low Carb Lifestyle',
  'Postpartum Nutrition',
  'General Wellness',
]

export const DEFAULT_CUSTOMER_ALLERGIES: string[] = [
  'Citrus Allergy',
  'Pineapple Sensitivity',
  'Tomato Allergy',
  'Pepper Allergy',
  'Avocado Sensitivity',
  'Mushroom Allergy',
  'Nut Allergy',
  'Dairy Intolerance',
  'Egg Allergy',
  'Soy Allergy',
  'Gluten Sensitivity',
]

export function buildLabelMap(items: SegmentMasterItem[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const item of items || []) {
    if (!item?.code) continue
    map[String(item.code)] = String(item.label || item.code)
  }
  return map
}

export function resolveLabels(codes: string[] | undefined, labelMap: Record<string, string>): string[] {
  return (codes || [])
    .filter(Boolean)
    .map((code) => labelMap[String(code)] || String(code))
}

export function toLabelsText(codes: string[] | undefined, labelMap: Record<string, string>): string {
  const labels = resolveLabels(codes, labelMap)
  return labels.length ? labels.join(', ') : '-'
}

export function nextCode(existingCodes: string[], prefix: string): string {
  const nums = existingCodes
    .map((code) => String(code || ''))
    .filter((code) => code.startsWith(prefix))
    .map((code) => Number(code.slice(prefix.length)))
    .filter((n) => Number.isFinite(n))

  const next = (nums.length ? Math.max(...nums) : 0) + 1
  return `${prefix}${String(next).padStart(3, '0')}`
}
