import React from 'react';
import Link from '@docusaurus/Link';
import {domains} from '../../data/domains.mjs';

export default function DomainIndex() {
  return (
    <table>
      <thead><tr><th>技术领域</th><th>主要内容</th></tr></thead>
      <tbody>{domains.map(domain => (
        <tr key={domain.directory}>
          <td><Link to={domain.to}>{domain.title}</Link></td>
          <td>{domain.note}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}
