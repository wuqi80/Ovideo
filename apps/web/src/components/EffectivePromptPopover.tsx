import { Button, Popover, Typography } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface GenMeta {
  effectivePrompt?: string;
  refImages?: string[];
  /**
   * 因超出单次上限而没有上送的参考图。
   * 【为什么必须显示出来】这个弹窗是排查"形象怎么不一致"的唯一入口。
   * 服务端一次最多送 5 张，镜头挂 6 个以上标签时多出来的就送不进去；
   * 若只列已送的 5 条而不提被丢的，用户会一路去怀疑模型和提示词，
   * 永远想不到有两张压根没发——而每次重抽都是真金白银。
   */
  droppedRefs?: string[];
}

/**
 * 生成透明度：展示某张生成图实际送给模型的完整提示词与参考图清单。
 * 数据来自 Asset.metaJson（生成执行器写入）；上传图或旧版本生成的图没有此数据。
 */
export function EffectivePromptPopover({
  metaJson,
  compact = false,
}: {
  metaJson: string | undefined;
  /** true = 图块角标按钮形态（用于候选缩略图叠加层）；false = 文字链接形态 */
  compact?: boolean;
}) {
  let meta: GenMeta = {};
  try {
    meta = JSON.parse(metaJson ?? '{}') as GenMeta;
  } catch {
    /* 坏数据当作无记录 */
  }
  const refImages = meta.refImages ?? [];
  const droppedRefs = meta.droppedRefs ?? [];
  const hasData = Boolean(meta.effectivePrompt) || refImages.length > 0 || droppedRefs.length > 0;

  const content = hasData ? (
    <div style={{ maxWidth: 420 }}>
      {meta.effectivePrompt !== undefined && meta.effectivePrompt !== '' && (
        <Paragraph
          copyable
          style={{
            whiteSpace: 'pre-wrap',
            fontSize: 12,
            maxHeight: 260,
            overflow: 'auto',
            marginBottom: refImages.length > 0 ? 8 : 0,
          }}
        >
          {meta.effectivePrompt}
        </Paragraph>
      )}
      {refImages.length > 0 && (
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            参考图：
          </Text>
          {refImages.map((r, i) => (
            <div key={i} style={{ fontSize: 12, wordBreak: 'break-all' }}>
              {r}
            </div>
          ))}
        </div>
      )}
      {droppedRefs.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          <Text type="warning" style={{ fontSize: 12 }}>
            {`另有 ${droppedRefs.length} 张参考图未发送（单次最多 5 张）：`}
          </Text>
          {droppedRefs.map((r, i) => (
            <div key={i} style={{ fontSize: 12, wordBreak: 'break-all', opacity: 0.75 }}>
              {r}
            </div>
          ))}
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
            这几个标签的形象没有参与本次生成。若它们对这一镜很重要，可以拆成两镜，
            或在设计页把次要标签的绑定取消。
          </Text>
        </div>
      )}
    </div>
  ) : (
    <Text type="secondary" style={{ fontSize: 12 }}>
      该图未记录生成信息（上传图或旧版本生成的图没有此数据）
    </Text>
  );

  return (
    <Popover content={content} title="送给模型的实际提示词" trigger="click" placement="right">
      {compact ? (
        <Button
          size="small"
          icon={<FileTextOutlined />}
          onClick={(e) => e.stopPropagation()}
          style={{ opacity: 0.85 }}
        />
      ) : (
        <Text type="secondary" style={{ fontSize: 12, cursor: 'pointer' }}>
          <FileTextOutlined /> 实际提示词
        </Text>
      )}
    </Popover>
  );
}
