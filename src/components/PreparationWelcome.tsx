export function PreparationWelcome() {
  return <section aria-label="开始任务" className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
    <div className="w-full max-w-3xl py-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-violet-700">从对话开始</p>
      <h2 className="mt-3 text-3xl font-semibold text-slate-900">今天想完成什么任务？</h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">描述目标，或提供数据与模型的位置。Agent 会通过对话、只读探查和检索补齐信息，并把工作流计划展示给你。</p>
      <ol className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          ['01', '收集信息', '在对话中核对 Checklist，缺少的信息继续沟通。'],
          ['02', '审阅计划', '查看 workflowPLAN，通过对话修改，确认后创建并启动。'],
          ['03', '阶段执行', 'Project 工作台按 Stage 展示子 Agent、执行状态和报告。'],
        ].map(([number, title, description]) => <li key={number} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <span className="text-xs font-semibold text-violet-600">{number}</span>
          <h3 className="mt-3 text-sm font-semibold">{title}</h3>
          <p className="mt-2 text-xs leading-6 text-slate-500">{description}</p>
        </li>)}
      </ol>
      <p className="mt-6 text-xs text-slate-400">在下方输入任务目标，开始准备。</p>
    </div>
  </section>;
}
