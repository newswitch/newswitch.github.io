import React from 'react';
import isInternalUrl from '@docusaurus/isInternalUrl';
import OriginalDocCard from '@theme-original/DocCard';

function getFallbackIcon(item) {
  if (item.type === 'category') {
    return '🗃';
  }

  return isInternalUrl(item.href) ? '📄️' : '🔗';
}

function preserveNumericLabel(item) {
  if (!/^\d/.test(item.label)) {
    return item;
  }

  return {
    ...item,
    label: `${getFallbackIcon(item)} ${item.label}`,
  };
}

export default function DocCard(props) {
  return <OriginalDocCard {...props} item={preserveNumericLabel(props.item)} />;
}
