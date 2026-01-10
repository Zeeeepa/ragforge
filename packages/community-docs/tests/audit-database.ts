const API_URL = 'http://127.0.0.1:6970';

async function cypher(query: string): Promise<any[]> {
  const response = await fetch(`${API_URL}/cypher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const data = await response.json();
  return data.records || [];
}

function toNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'object' && 'low' in val) return val.low;
  return Number(val);
}

async function audit() {
  console.log('============================================================');
  console.log('DATABASE AUDIT - Community Docs');
  console.log('============================================================\n');

  let issues: string[] = [];
  let stats = {
    files: 0,
    mediaFiles: 0,
    documents: 0,
    sections: 0,
    entities: 0,
    canonicals: 0,
    tags: 0,
    embeddingChunks: 0,
  };

  // 0. Check constraints exist
  console.log('=== 0. DATABASE CONSTRAINTS ===');
  const constraints = await cypher(`SHOW CONSTRAINTS`);
  const expectedConstraints = ['canonical_entity_unique', 'tag_unique'];
  for (const expected of expectedConstraints) {
    const found = constraints.find((c: any) => c.name === expected);
    if (found) {
      console.log(`  ✓ ${expected} (${found.labelsOrTypes.join(', ')})`);
    } else {
      console.log(`  ❌ ${expected} - MISSING`);
      issues.push(`Missing constraint: ${expected}`);
    }
  }

  // 1. Check File nodes
  console.log('\n=== 1. FILE NODES ===');
  const files = await cypher(`MATCH (f:File) RETURN f.name as name, f.extension as ext, f.path as path`);
  stats.files = files.length;
  console.log(`  Total: ${files.length}`);
  for (const f of files) {
    const status = f.name && f.ext ? '✓' : '❌';
    console.log(`  ${status} ${f.name || 'NO NAME'}${f.ext || ''}`);
    if (!f.name) issues.push(`File missing name: ${JSON.stringify(f)}`);
  }

  // 2. Check MediaFiles (images, 3D models)
  console.log('\n=== 2. MEDIA FILES (Vision) ===');
  const media = await cypher(`
    MATCH (m:MediaFile)
    RETURN m.file as file, m.category as cat, m.analyzed as analyzed,
           m.description as desc, m.embedding_description IS NOT NULL as hasEmbedding
  `);
  stats.mediaFiles = media.length;
  console.log(`  Total: ${media.length}`);
  for (const m of media) {
    const hasDesc = m.desc && m.desc.length > 0;
    const status = hasDesc && m.hasEmbedding ? '✓' : '❌';
    console.log(`  ${status} ${m.file} (${m.cat}) - desc: ${hasDesc ? `${m.desc.length}ch` : 'MISSING'}, emb: ${m.hasEmbedding ? 'yes' : 'NO'}`);
    if (!hasDesc) issues.push(`MediaFile missing description: ${m.file}`);
    if (!m.hasEmbedding) issues.push(`MediaFile missing embedding: ${m.file}`);
  }

  // 3. Check MarkdownDocuments (have sections with content)
  console.log('\n=== 3. MARKDOWN DOCUMENTS ===');
  const docs = await cypher(`
    MATCH (d:MarkdownDocument)
    OPTIONAL MATCH (s:MarkdownSection)-[:IN_DOCUMENT]->(d)
    WITH d, count(s) as sectionCount
    RETURN d.sourcePath as path, d.pageCount as pages, sectionCount
  `);
  stats.documents = docs.length;
  console.log(`  Total: ${docs.length}`);
  for (const d of docs) {
    const status = toNumber(d.sectionCount) > 0 ? '✓' : '❌';
    console.log(`  ${status} ${d.path} - ${toNumber(d.pages)} pages, ${toNumber(d.sectionCount)} sections`);
    if (toNumber(d.sectionCount) === 0) issues.push(`MarkdownDocument has no sections: ${d.path}`);
  }

  // 4. Check MarkdownSections (have content and embeddings - either direct or via chunks)
  console.log('\n=== 4. MARKDOWN SECTIONS ===');
  const sections = await cypher(`
    MATCH (s:MarkdownSection)
    OPTIONAL MATCH (s)-[:HAS_EMBEDDING_CHUNK]->(c:EmbeddingChunk)
    WITH s, count(c) as chunkCount
    RETURN s.title as title, s.sourcePath as path,
           s.content IS NOT NULL as hasContent,
           s.embedding_content IS NOT NULL as hasDirectEmbedding,
           chunkCount
  `);
  stats.sections = sections.length;
  console.log(`  Total: ${sections.length}`);
  const sectionIssues = sections.filter((s: any) => !s.hasContent || (!s.hasDirectEmbedding && toNumber(s.chunkCount) === 0));
  if (sectionIssues.length > 0) {
    for (const s of sectionIssues) {
      const embStatus = s.hasDirectEmbedding ? 'direct' : (toNumber(s.chunkCount) > 0 ? `${toNumber(s.chunkCount)} chunks` : 'NO');
      console.log(`  ❌ ${s.title || s.path} - content: ${s.hasContent ? 'yes' : 'NO'}, emb: ${embStatus}`);
      if (!s.hasContent) issues.push(`MarkdownSection missing content: ${s.title || s.path}`);
      if (!s.hasDirectEmbedding && toNumber(s.chunkCount) === 0) issues.push(`MarkdownSection missing embedding: ${s.title || s.path}`);
    }
  } else {
    console.log(`  ✓ All sections have content and embeddings`);
    // Show breakdown
    const withDirect = sections.filter((s: any) => s.hasDirectEmbedding).length;
    const withChunks = sections.filter((s: any) => toNumber(s.chunkCount) > 0).length;
    console.log(`    (${withDirect} with direct embedding, ${withChunks} with chunks)`);
  }

  // 5. Check Entities
  console.log('\n=== 5. ENTITIES ===');
  const entities = await cypher(`
    MATCH (e:Entity)
    OPTIONAL MATCH (e)-[:CANONICAL_IS]->(c:CanonicalEntity)
    RETURN e.name as name, e.entityType as type, e.uuid as uuid, c.name as canonical
  `);
  stats.entities = entities.length;
  console.log(`  Total: ${entities.length}`);
  const unlinkedEntities = entities.filter((e: any) => !e.canonical);
  if (unlinkedEntities.length > 0) {
    console.log(`  ❌ ${unlinkedEntities.length} entities not linked to canonical`);
    issues.push(`${unlinkedEntities.length} entities without canonical link`);
  } else {
    console.log(`  ✓ All entities linked to canonicals`);
  }

  // 6. Check CanonicalEntities (no duplicates)
  console.log('\n=== 6. CANONICAL ENTITIES ===');
  const canonicals = await cypher(`MATCH (c:CanonicalEntity) RETURN c.name as name, c.entityType as type, c.normalizedName as norm`);
  stats.canonicals = canonicals.length;
  console.log(`  Total: ${canonicals.length}`);

  const duplicates = await cypher(`
    MATCH (c:CanonicalEntity)
    WITH c.normalizedName as norm, c.entityType as type, collect(c.name) as names, count(c) as cnt
    WHERE cnt > 1
    RETURN norm, type, names, cnt
  `);
  if (duplicates.length > 0) {
    console.log('  ❌ DUPLICATES FOUND:');
    for (const d of duplicates) {
      console.log(`    - ${d.norm} (${d.type}): ${toNumber(d.cnt)}x`);
      issues.push(`Duplicate canonical: ${d.norm} (${d.type})`);
    }
  } else {
    console.log('  ✓ No duplicates');
  }

  // 7. Check Tags (no duplicates, have normalizedName)
  console.log('\n=== 7. TAGS ===');
  const tags = await cypher(`MATCH (t:Tag) RETURN t.name as name, t.normalizedName as norm, t.category as cat`);
  stats.tags = tags.length;
  console.log(`  Total: ${tags.length}`);

  const tagDuplicates = await cypher(`
    MATCH (t:Tag)
    WITH t.normalizedName as norm, collect(t.name) as names, count(t) as cnt
    WHERE cnt > 1
    RETURN norm, names, cnt
  `);
  if (tagDuplicates.length > 0) {
    console.log('  ❌ DUPLICATE TAGS:');
    for (const d of tagDuplicates) {
      console.log(`    - ${d.norm}: ${toNumber(d.cnt)}x`);
      issues.push(`Duplicate tag: ${d.norm}`);
    }
  } else {
    console.log('  ✓ No duplicate tags');
  }

  const tagsWithoutNorm = tags.filter((t: any) => !t.norm);
  if (tagsWithoutNorm.length > 0) {
    console.log(`  ❌ ${tagsWithoutNorm.length} tags missing normalizedName`);
    issues.push(`${tagsWithoutNorm.length} tags without normalizedName`);
  }

  // 8. Check EmbeddingChunks (have text and embedding_content)
  console.log('\n=== 8. EMBEDDING CHUNKS ===');
  const chunkStats = await cypher(`
    MATCH (e:EmbeddingChunk)
    RETURN count(e) as total,
           sum(CASE WHEN e.text IS NOT NULL THEN 1 ELSE 0 END) as withText,
           sum(CASE WHEN e.embedding_content IS NOT NULL THEN 1 ELSE 0 END) as withEmbedding,
           avg(size(e.embedding_content)) as avgDim
  `);
  if (chunkStats.length > 0) {
    const s = chunkStats[0];
    stats.embeddingChunks = toNumber(s.total);
    const total = toNumber(s.total);
    const withText = toNumber(s.withText);
    const withEmb = toNumber(s.withEmbedding);
    const avgDim = Math.round(toNumber(s.avgDim));

    console.log(`  Total: ${total}`);
    console.log(`  With text: ${withText}/${total} ${withText === total ? '✓' : '❌'}`);
    console.log(`  With embedding: ${withEmb}/${total} ${withEmb === total ? '✓' : '❌'}`);
    console.log(`  Avg dimension: ${avgDim}`);

    if (withText < total) issues.push(`${total - withText} EmbeddingChunks missing text`);
    if (withEmb < total) issues.push(`${total - withEmb} EmbeddingChunks missing embedding`);
  }

  // 9. Check orphaned nodes
  console.log('\n=== 9. ORPHANED NODES ===');
  const orphanedEntities = await cypher(`
    MATCH (e:Entity) WHERE NOT (e)<-[:CONTAINS_ENTITY]-() RETURN count(e) as cnt
  `);
  const orphanedTags = await cypher(`
    MATCH (t:Tag) WHERE NOT (t)<-[:HAS_TAG]-() RETURN count(t) as cnt
  `);
  const orphanedChunks = await cypher(`
    MATCH (c:EmbeddingChunk) WHERE NOT (c)<-[:HAS_EMBEDDING_CHUNK]-() RETURN count(c) as cnt
  `);

  const oEntities = toNumber(orphanedEntities[0]?.cnt);
  const oTags = toNumber(orphanedTags[0]?.cnt);
  const oChunks = toNumber(orphanedChunks[0]?.cnt);

  if (oEntities > 0 || oTags > 0 || oChunks > 0) {
    if (oEntities > 0) { console.log(`  ❌ ${oEntities} orphaned entities`); issues.push(`${oEntities} orphaned entities`); }
    if (oTags > 0) { console.log(`  ❌ ${oTags} orphaned tags`); issues.push(`${oTags} orphaned tags`); }
    if (oChunks > 0) { console.log(`  ❌ ${oChunks} orphaned chunks`); issues.push(`${oChunks} orphaned chunks`); }
  } else {
    console.log('  ✓ No orphaned nodes');
  }

  // 10. Test search functionality
  console.log('\n=== 10. SEARCH TEST ===');
  const searchResponse = await fetch(`${API_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'test document', limit: 1, semantic: true }),
  });
  const searchData = await searchResponse.json();
  if (searchData.results && searchData.results.length > 0) {
    const r = searchData.results[0];
    console.log(`  ✓ Search works - score: ${r.score?.toFixed(3) || 'N/A'}`);
    if (r.content) console.log(`    Content preview: ${r.content.substring(0, 80)}...`);
  } else {
    console.log('  ❌ Search returned no results');
    issues.push('Search returned no results');
  }

  // Summary
  console.log('\n============================================================');
  console.log('SUMMARY');
  console.log('============================================================');
  console.log(`  Files:           ${stats.files}`);
  console.log(`  Media files:     ${stats.mediaFiles}`);
  console.log(`  Documents:       ${stats.documents}`);
  console.log(`  Sections:        ${stats.sections}`);
  console.log(`  Entities:        ${stats.entities}`);
  console.log(`  Canonicals:      ${stats.canonicals}`);
  console.log(`  Tags:            ${stats.tags}`);
  console.log(`  EmbeddingChunks: ${stats.embeddingChunks}`);

  console.log('\n============================================================');
  if (issues.length === 0) {
    console.log('✓ ALL CHECKS PASSED');
  } else {
    console.log(`❌ ${issues.length} ISSUES FOUND:`);
    for (const issue of issues) {
      console.log(`  - ${issue}`);
    }
  }
  console.log('============================================================');

  process.exit(issues.length > 0 ? 1 : 0);
}

audit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
