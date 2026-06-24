import { WorkData } from "./types";

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const tracking = (hours = 0) => ({ isRunning: false, startedAt: null, accumulatedSeconds: Math.round(hours * 3600), lastPausedAt: null, sessions: [] });

export const seedData: WorkData = {
  version: 2,
  projects: [
    { id: "p1", name: "增长实验", type: "业务增长", background: "核心漏斗增速放缓，需要通过产品实验寻找新的转化杠杆。", goal: "Q2 核心转化率提升 12%，沉淀可复用实验机制。", status: "Active", priority: "P0", progress: 68, startDate: day(-45), dueDate: day(30), relatedTaskIds: ["t1", "t4"], risks: ["渠道维度数据仍不完整", "实验样本周期可能延长"], nextAction: "完成复盘材料并确认下一轮实验范围" },
    { id: "p2", name: "数据基建", type: "内部能力", background: "现有埋点命名和统计口径不统一，影响分析效率。", goal: "建立统一埋点字典与核心指标口径。", status: "Active", priority: "P1", progress: 45, startDate: day(-30), dueDate: day(20), relatedTaskIds: ["t2"], risks: ["等待数据团队确认事件命名"], nextAction: "收到反馈后完成方案定稿" },
    { id: "p3", name: "客户洞察", type: "研究", background: "需要更系统理解中型团队的协作交接问题。", goal: "完成 5 家高活跃客户访谈并输出洞察报告。", status: "Active", priority: "P1", progress: 25, startDate: day(-8), dueDate: day(25), relatedTaskIds: ["t3"], risks: [], nextAction: "完成访谈提纲并预约首批客户" },
    { id: "p4", name: "体验优化", type: "产品体验", background: "新用户首次使用路径存在理解成本。", goal: "优化新手引导并降低首日流失。", status: "Active", priority: "P2", progress: 82, startDate: day(-28), dueDate: day(8), relatedTaskIds: ["t6"], risks: [], nextAction: "跟进新版文案上线后的数据" },
  ],
  tasks: [
    { id: "t1", title: "整理 Q2 项目复盘材料", description: "汇总目标、关键结果和复盘结论", status: "Doing", priority: "P0", projectId: "p1", requester: "林薇", createdBy: "自己", source: "项目群", createdAt: day(-2), dueDate: day(1), estimatedHours: 3, actualHours: 1.8, subtasks: [{ id: "st1", title: "汇总目标与结果", done: true, order: 0, createdAt: day(-2) }, { id: "st2", title: "补充渠道拆分结论", done: false, order: 1, createdAt: day(-2) }], waitingFor: "", tags: [], notes: "", timeTracking: tracking(1.8) },
    { id: "t2", title: "确认新版埋点方案", description: "与数据团队确认事件命名和口径", status: "Waiting", priority: "P1", projectId: "p2", requester: "自己", createdBy: "自己", source: "会议", createdAt: day(-5), dueDate: day(0), estimatedHours: 1.5, actualHours: 0.8, subtasks: [{ id: "st3", title: "整理事件命名草案", done: true, order: 0, createdAt: day(-5) }, { id: "st4", title: "等待数据团队确认", done: false, order: 1, createdAt: day(-5) }], waitingForType: "legacy", waitingFor: "陈航 / 数据团队", waitingReason: "确认事件命名和统计口径", followUpDate: day(2), tags: [], notes: "", timeTracking: tracking(0.8) },
    { id: "t3", title: "输出客户访谈提纲", description: "覆盖使用场景、决策链与核心痛点", status: "Todo", priority: "P1", projectId: "p3", requester: "周敏", createdBy: "自己", source: "私聊", createdAt: day(-1), dueDate: day(2), estimatedHours: 2, actualHours: 0, subtasks: [], waitingFor: "", tags: [], notes: "", timeTracking: tracking() },
    { id: "t4", title: "补充周会数据看板", description: "新增转化漏斗和渠道拆分", status: "Done", priority: "P2", projectId: "p1", requester: "林薇", createdBy: "自己", source: "周会", createdAt: day(-4), dueDate: day(-1), estimatedHours: 2, actualHours: 2.6, subtasks: [{ id: "st5", title: "新增转化漏斗", done: true, order: 0, createdAt: day(-4) }, { id: "st6", title: "补充渠道拆分", done: true, order: 1, createdAt: day(-4) }], waitingFor: "", completedAt: day(-1), tags: [], notes: "", timeTracking: tracking(2.6) },
    { id: "t5", title: "预约供应商方案评审", description: "协调下周时间", status: "Inbox", priority: "P2", projectId: "", requester: "许靖", createdBy: "自己", source: "邮件", createdAt: day(0), dueDate: "", estimatedHours: .5, actualHours: 0, subtasks: [], waitingFor: "", tags: [], notes: "", timeTracking: tracking() },
    { id: "t6", title: "完成新手引导文案走查", description: "统一术语并补充异常分支", status: "Done", priority: "P1", projectId: "p4", requester: "自己", createdBy: "自己", source: "产品评审", createdAt: day(-6), dueDate: day(-2), estimatedHours: 1.5, actualHours: 1.2, subtasks: [{ id: "st7", title: "统一术语", done: true, order: 0, createdAt: day(-6) }, { id: "st8", title: "补充异常分支", done: true, order: 1, createdAt: day(-6) }], waitingFor: "", completedAt: day(-2), tags: [], notes: "", timeTracking: tracking(1.2) },
  ],
  meetings: [
    { id: "m1", title: "增长项目周会", date: `${day(0)}T10:00`, durationMinutes: 60, attendees: ["林薇", "周敏", "陈航"], relatedProjectId: "p1", notes: "复盘上周实验数据，A 方案转化率提升 8.4%。本周继续扩大样本，同时补齐渠道维度。", decisions: ["A 方案扩大至 50% 流量", "周五前完成渠道数据拆分"], actionItems: [{ id: "a1", text: "整理 Q2 项目复盘材料", owner: "我", dueDate: day(1), taskId: "t1" }, { id: "a2", text: "补充渠道维度数据", owner: "陈航", dueDate: day(2) }] },
    { id: "m2", title: "客户洞察同步", date: `${day(-1)}T15:30`, durationMinutes: 45, attendees: ["周敏", "许靖"], relatedProjectId: "p3", notes: "确定本轮访谈聚焦中型团队的协作交接问题。", decisions: ["优先访谈 5 家高活跃客户"], actionItems: [{ id: "a3", text: "输出客户访谈提纲", owner: "我", dueDate: day(2), taskId: "t3" }] },
  ],
  reflections: [
    { id: "r1", title: "会议结束后立即结构化 Action Item", content: "把会议纪要中的动作、负责人和时间拆出来，减少会后遗忘。可以考虑用统一模板自动解析。", type: "流程优化", relatedProjectId: "p1", relatedTaskId: "t1", date: day(-1), durationMinutes: 20, tags: ["会议", "流程"] },
    { id: "r2", title: "用历史偏差校准预估", content: "我在分析类任务上通常低估 25% 左右，下次预估时应自动加上缓冲。", type: "经验沉淀", relatedProjectId: "p2", relatedTaskId: "t2", date: day(-3), durationMinutes: 15, tags: ["预估", "效率"] },
    { id: "r3", title: "客户访谈的样本风险", content: "只访谈高活跃客户可能造成幸存者偏差，需要至少补充一组低活跃样本。", type: "风险提醒", relatedProjectId: "p3", relatedTaskId: "t3", date: day(-2), durationMinutes: 15, tags: ["研究"] },
  ],
  reports: [],
  contacts: [
    { id: "c1", name: "林薇", role: "业务负责人", team: "增长组", company: "内部", email: "", phone: "", notes: "增长实验主要对接人", createdAt: day(-45), updatedAt: day(-45) },
    { id: "c2", name: "周敏", role: "用户研究", team: "研究组", company: "内部", email: "", phone: "", notes: "客户洞察协作", createdAt: day(-30), updatedAt: day(-30) },
    { id: "c3", name: "陈航", role: "数据分析", team: "数据团队", company: "内部", email: "", phone: "", notes: "埋点与口径确认", createdAt: day(-30), updatedAt: day(-30) },
    { id: "c4", name: "许靖", role: "商务协作", team: "项目协作", company: "外部", email: "", phone: "", notes: "供应商和客户预约", createdAt: day(-20), updatedAt: day(-20) },
  ],
  contactGroups: [
    { id: "g1", name: "增长周会", description: "增长项目固定参会人", contactIds: ["c1", "c2", "c3"], createdAt: day(-20), updatedAt: day(-20) },
    { id: "g2", name: "客户洞察协作组", description: "研究与外部访谈协作", contactIds: ["c2", "c4"], createdAt: day(-10), updatedAt: day(-10) },
  ],
};
