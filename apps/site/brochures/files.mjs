// The brochures' PDFs (static/downloads, a .jpg preview of the first page beside each), per language and audience:
// the website links them (src/pages.mjs), ../videos/brochures.mjs writes them. German keeps the names it has had.
export const BROCHURE_FILES = {
  de: { trustees: 'apensum-broschuere-treuhaender.pdf', customers: 'apensum-broschuere-endkunden.pdf', partners: 'apensum-broschuere-it-partner.pdf' },
  fr: { trustees: 'apensum-brochure-fiduciaires.pdf', customers: 'apensum-brochure-entreprises.pdf', partners: 'apensum-brochure-partenaires-it.pdf' },
  it: { trustees: 'apensum-brochure-fiduciarie.pdf', customers: 'apensum-brochure-aziende.pdf', partners: 'apensum-brochure-partner-it.pdf' },
  en: { trustees: 'apensum-brochure-fiduciaries.pdf', customers: 'apensum-brochure-companies.pdf', partners: 'apensum-brochure-it-partners.pdf' },
};

export const BROCHURE_AUDIENCES = ['trustees', 'customers', 'partners'];
