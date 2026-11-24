import type { ObservationDetailSection, ObservationMetricGroup, ObservationsConfig } from './observationsContract';

const legacyMetricGroups: ObservationMetricGroup[] = [
  { title: '整体表现', labels: {
    label_accuracy: '标签准确率', macro_f1: 'Macro-F1', evaluated_samples: '评估样本',
    api_or_evaluation_errors: '调用或评估错误', mean_overall_score: '综合评分', mean_latency_seconds: '平均时延',
  } },
  { title: '定位表现', labels: { box_f1: '定位 F1', box_precision: '定位精确率', box_recall: '定位召回率' } },
  { title: '分类表现', labels: {
    pass_precision: 'Pass 精确率', pass_recall: 'Pass 召回率', defect_precision: 'Defect 精确率',
    defect_recall: 'Defect 召回率', fail_precision: 'Fail 精确率', fail_recall: 'Fail 召回率',
  } },
];

export function observationSections(config: ObservationsConfig, nodeId: string, stageType: string,
  moduleLabel: string, subject: string): ObservationDetailSection[] {
  const layout = config.detail_forms;
  const configured = layout?.schema_version === 1 && Array.isArray(layout.forms)
    ? layout.forms.find(form => form.project_node_id === nodeId) : undefined;
  if (configured) return configured.sections.filter(section =>
    ['report_version', 'analysis_version', 'task_id'].includes(section.selection));

  // Older observation responses have only the training panel configuration.
  const label = `${moduleLabel} report`;
  const versionSelect = { type: 'select', label: 'Report version', min_options: 2 } as const;
  switch (stageType) {
    case 'init':
      return [{ id: 'report', label, selection: 'report_version', blocks: [
        { type: 'select', label: 'Report version' },
        { type: 'status', source: 'report', subject, loading_message: '正在读取基线评估报告',
          unavailable_message: '暂时无法读取所选版本的基线评估报告' },
        { type: 'metrics', source: 'report', groups: legacyMetricGroups, empty_message: '所选报告未提供结构化指标' },
        { type: 'findings' }, { type: 'artifacts' },
      ] }];
    case 'dataset':
      return [{ id: 'report', label, selection: 'analysis_version', blocks: [
        versionSelect,
        { type: 'status', source: 'report', subject, loading_message: '正在读取已登记的数据集详情',
          unavailable_message: '暂时无法读取数据集详情' },
        { type: 'dataset_files', empty_message: '数据集报告已登记，未提供文件路径' },
      ] }];
    case 'eval':
      return [{ id: 'analysis', label, selection: 'analysis_version', blocks: [
        { type: 'select', label: 'Report version' },
        { type: 'status', source: 'analysis', subject },
        { type: 'metrics', source: 'analysis', empty_message: '所选版本未提供结构化指标' },
      ] }];
    default: {
      const analysis: ObservationDetailSection = { id: 'analysis', label, selection: 'analysis_version', blocks: [
        versionSelect, { type: 'status', source: 'analysis', subject },
        { type: 'summary' }, { type: 'metrics', source: 'analysis' }, { type: 'findings' }, { type: 'artifacts' },
        { type: 'analysis_version' },
      ] };
      if (stageType !== 'train') return [analysis];
      const trainingType = config.panels.find(panel => panel.project_node_id === nodeId)?.training_type || 'Training';
      return [{ id: 'curves', label: `${trainingType} training metrics`, selection: 'task_id',
        blocks: [{ type: 'select', label: 'Task ID' }, { type: 'training_curves' }] }, analysis];
    }
  }
}
