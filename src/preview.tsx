import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { MarkdownContent } from './components/MarkdownContent';

const sample = `# 结构化输出示例

这是**加粗**、*斜体*、~~删除线~~和行内代码 \`const x = 1\` 的混排段落。

## 步骤

1. 读取输入
2. 清洗数据
   1. 去重
   2. 补全缺失值
3. 输出结果

### 检查项

- [x] schema 校验
- [ ] 指标回流

> 注意：该结果基于最近一次批量运行。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 主键 |
| score | number | 置信度 |

\`\`\`python
def normalize(records):
    return [r for r in records if r.get("score")]
\`\`\`

详见[接口文档](https://example.com/docs)。

---

![preview](data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22240%22%20height%3D%2260%22%3E%3Crect%20width%3D%22240%22%20height%3D%2260%22%20fill%3D%22%23dbeafe%22%2F%3E%3Ctext%20x%3D%2216%22%20y%3D%2236%22%20font-family%3D%22sans-serif%22%20font-size%3D%2214%22%20fill%3D%22%232563eb%22%3Eimage%20asset%3C%2Ftext%3E%3C%2Fsvg%3E)
`;

function Preview() {
  return (
    <div className="min-h-screen bg-white p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm whitespace-pre-wrap text-white">
            用 **Markdown** 展示一下结构化结果
          </div>
        </div>
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-xl rounded-bl-sm bg-gray-100 px-4 py-2.5 text-sm whitespace-pre-wrap text-gray-900">
            <MarkdownContent imageClassName="max-h-72 max-w-full rounded-lg object-contain">
              {sample}
            </MarkdownContent>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('preview-root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
