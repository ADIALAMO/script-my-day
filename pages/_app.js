import '../styles/globals.css';
import Head from 'next/head';

function MyApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>LIFESCRIPT STUDIO</title>
        {/* מניעת זום אוטומטי במובייל שעלול להרוס את העיצוב */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
        <meta name="theme-color" content="#0a0a0a" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className="min-h-screen bg-[#0a0a0a]">
        <Component {...pageProps} />
      </main>
    </>
  );
}

export default MyApp;