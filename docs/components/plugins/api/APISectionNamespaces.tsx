import ReactMarkdown from 'react-markdown';

import {
  ClassDefinitionData,
  GeneratedData,
  PropData,
} from '~/components/plugins/api/APIDataTypes';
import { APISectionDeprecationNote } from '~/components/plugins/api/APISectionDeprecationNote';
import { renderMethod } from '~/components/plugins/api/APISectionMethods';
import { APISectionPlatformTags } from '~/components/plugins/api/APISectionPlatformTags';
import {
  CommentTextBlock,
  getTagData,
  getTagNamesList,
  mdComponents,
  STYLES_APIBOX,
  TypeDocKind,
  H3Code,
  getCommentContent,
  BoxSectionHeader,
} from '~/components/plugins/api/APISectionUtils';
import { H2, MONOSPACE } from '~/ui/components/Text';

export type APISectionNamespacesProps = {
  data: GeneratedData[];
  sdkVersion: string;
};

const isMethod = (child: PropData, allowOverwrites: boolean = false) =>
  child.kind &&
  [TypeDocKind.Method, TypeDocKind.Function].includes(child.kind) &&
  (allowOverwrites || !child.overwrites) &&
  !child.name.startsWith('_') &&
  !child?.implementationOf;

function getValidMethods(children: PropData[]) {
  return children
    ?.filter(child => isMethod(child))
    .sort((a: PropData, b: PropData) => a.name.localeCompare(b.name));
}

const renderNamespace = (namespace: ClassDefinitionData, sdkVersion: string): JSX.Element => {
  const { name, comment, children } = namespace;

  const methods = getValidMethods(children);
  const returnComment = getTagData('returns', comment);

  return (
    <div key={`class-definition-${name}`} css={STYLES_APIBOX}>
      <APISectionDeprecationNote comment={comment} sticky />
      <APISectionPlatformTags comment={comment} />
      <H3Code tags={getTagNamesList(comment)}>
        <MONOSPACE weight="medium" className="wrap-anywhere">
          {name}
        </MONOSPACE>
      </H3Code>
      <CommentTextBlock comment={comment} includePlatforms={false} />
      {returnComment && (
        <>
          <BoxSectionHeader text="Returns" />
          <ReactMarkdown components={mdComponents}>
            {getCommentContent(returnComment.content)}
          </ReactMarkdown>
        </>
      )}
      {methods?.length ? (
        <>
          <BoxSectionHeader text={`${name} Methods`} exposeInSidebar={false} />
          {methods.map(method => renderMethod(method, { sdkVersion, baseNestingLevel: 4 }))}
        </>
      ) : undefined}
    </div>
  );
};

const APISectionNamespaces = ({ data, sdkVersion }: APISectionNamespacesProps) => {
  if (data?.length) {
    return (
      <>
        <H2>Namespaces</H2>
        {data.map(namespace => renderNamespace(namespace, sdkVersion))}
      </>
    );
  }
  return null;
};

export default APISectionNamespaces;
