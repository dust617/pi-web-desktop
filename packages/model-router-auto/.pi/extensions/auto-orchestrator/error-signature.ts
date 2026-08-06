/**
 * auto-orchestrator / error-signature.ts
 * 错误签名归一化（纯函数）。从 provider 抽出，供 reducer 统一使用。
 * 归一化：去引号串/数字/空白等易变细节，保留错误类型特征；同一签名重复出现即视为同因失败。
 */
export function normalizeErrorSignature(errorMessage: string): string {
  return errorMessage
    // 引号串整体归一："..." 和 '...' 整体替换为 X。斜杠不参与配对，避免含反斜杠的
    // Windows 路径（如 "C:\a.ts"）被拆碎、残留文件名片段导致同因错误误判为不同签名。
    .replace(/"[^"]*"/g, "X")
    .replace(/'[^']*'/g, "X")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 120);
}
