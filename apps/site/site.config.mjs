// Settings of the website. The build reads them; the `site` workflow can override the
// SITE_* environment variables. The legal notice (Impressum) needs the operator's name and
// address: a `--strict` build (the deploy) fails while any of the required fields is empty.
export default {
  /** Public hostname, without www (www redirects here). */
  domain: process.env.SITE_DOMAIN || 'apensum.ch',
  /** The live demo (sample data, demo accounts on its login page): every "Demo" button. */
  demoUrl: process.env.SITE_DEMO_URL || 'https://appdemo.apensum.ch',
  /** The app's web address for the "Log in" button; empty hides the button. */
  appUrl: process.env.SITE_APP_URL || '',
  /**
   * The contact form's target: the Apensum API's `public/contact` (it mails the message to
   * CONTACT_EMAIL). Empty = no form, only the e-mail link.
   */
  contactUrl: process.env.SITE_CONTACT_URL || '',
  /** Where contact mail goes (mailto links). */
  email: process.env.SITE_EMAIL || 'info@apensum.ch',
  /** Who runs the website (legal notice). A person for now: there is no company yet. */
  operator: {
    name: 'Fabio Poroli',
    street: 'Im Riet 18',
    /** Postcode and place. */
    city: '8260 Stein am Rhein',
    country: 'Schweiz / Suisse / Svizzera / Switzerland',
    /**
     * Shown only after a click ("Show phone number", static/assets/reveal.js): the page holds it
     * encoded, so crawlers and scrapers reading the HTML don't find it. Empty = no phone anywhere.
     */
    phone: '+41 79 746 30 88',
    /** Optional: someone else responsible for the content, UID once there is a company. */
    responsible: '',
    uid: '',
  },
  about: {
    /** Portrait (file in static/assets/). Empty = initials. */
    photo: '/assets/portrait.jpg',
    /** Full profile address, e.g. https://www.linkedin.com/in/... Empty = no link. */
    linkedin: 'https://www.linkedin.com/in/fabioporoli/',
  },
};

export const REQUIRED_OPERATOR_FIELDS = ['name', 'street', 'city'];
