import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('confirmation container renders Agent content without interpreting checkpoint documents', async () => {
  const server = await createServer({server:{middlewareMode:true,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'});
  try {
    const {ProjectConfirmationPanel} = await server.ssrLoadModule('/src/components/ProjectConfirmationPanel.tsx');
    const {UserInputCard} = await server.ssrLoadModule('/src/components/UserInputCard.tsx');
    const pending = [{request_id:'review',task_run_id:'run',checkpoint:{run_id:'run',checkpoint_id:'cp'},presentation:{title:'是否采用这个模型？',content:[{type:'text',text:'模型对比\n\n| 模型 | 得分 |\n|---|---|\n| Candidate | 0.9 |\n\n[完整报告](https://example.com/report.json)\n\n<script>unsafe()</script>'},{type:'image_url',url:'https://example.com/chart.png'}]},questions:[{id:'choice',prompt:'是否采用？',options:[{id:'yes',label:'采用'},{id:'no',label:'修改'}]}]}, {request_id:'other',questions:[{id:'q',prompt:'补充说明',options:[]}]}];
    const snapshot = {conversation_id:'chat',pending_inputs:pending,pending_permissions:[{permission_id:'run',description:'执行权限',choices:['deny','allow_once']}],experiment_executions:[{run_id:'run',state:'waiting_user',checkpoint:{checkpoint_id:'cp',status:'pending',document:{preview:[{input_records:[{text:'INTERNAL_PAYLOAD_MUST_NOT_RENDER'}]}]}}}]};
    const props = {snapshot,onRespond:async()=>{},onPermission:async()=>{},readMedia:async()=>({url:''})};
    assert.equal(renderToStaticMarkup(createElement(ProjectConfirmationPanel,props)), '');
    const original = renderToStaticMarkup(createElement(UserInputCard,{request:{request_id:'old',questions:pending[1].questions},onRespond:props.onRespond}));
    assert.match(original,/补充说明/);
    assert.doesNotMatch(original,/待确认|确认内容|清洗|小样/);
    const html = renderToStaticMarkup(createElement(ProjectConfirmationPanel,{...props,snapshot:{...snapshot,project:{project_id:'p'}}}));
    assert.match(html,/aria-label="待确认"/);
    assert.match(html,/3 项/);
    assert.match(html,/是否采用这个模型？/);
    assert.match(html,/<table>/);
    assert.match(html,/href="https:\/\/example.com\/report.json"/);
    assert.match(html,/src="https:\/\/example.com\/chart.png"/);
    assert.match(html,/补充说明/);
    assert.match(html,/允许本次执行/);
    assert.doesNotMatch(html,/INTERNAL_PAYLOAD|清洗前|清洗后|切换小样|<script>|checked=""/);
    const stale = renderToStaticMarkup(createElement(ProjectConfirmationPanel,{...props,snapshot:{...snapshot,project:{project_id:'p'},experiment_executions:[]}}));
    assert.match(stale,/是否采用这个模型？/);
    assert.match(stale,/取消提问/);
    assert.doesNotMatch(stale,/<fieldset disabled=""/);
  } finally {await server.close();}
});
