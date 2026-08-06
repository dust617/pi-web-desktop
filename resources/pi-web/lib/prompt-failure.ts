export interface PromptFailureRecovery {
  /** The client knows this request never reached the agent. */
  definitelyNotSent: boolean;
  /** Safe text suitable for the UI; never include raw transport/config details. */
  notice: string;
}

export function getPromptFailureRecovery(isEventStreamConnectionError: boolean): PromptFailureRecovery {
  return isEventStreamConnectionError
    ? {
        definitelyNotSent: true,
        notice: "连接中断，消息未发送；已恢复到输入框。",
      }
    : {
        definitelyNotSent: false,
        notice: "发送状态未确认。请刷新会话确认消息是否已送达后再重试。",
      };
}
