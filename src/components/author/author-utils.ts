export function formatConfidence(confidence: "low" | "medium" | "high" | null | undefined) {
  if (confidence === "high") {
    return "高";
  }
  if (confidence === "medium") {
    return "中";
  }
  if (confidence === "low") {
    return "低";
  }
  return "未知";
}

export function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}
