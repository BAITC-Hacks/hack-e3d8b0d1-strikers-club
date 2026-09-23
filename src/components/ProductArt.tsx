import { useId } from 'react';
import { Box } from '@mui/material';

export function ProductArt({ name }: { name: string }) {
  const gradientId = useId().replace(/:/g, '');
  const isCable = /кабел|провод|ввг|пвс|nym/i.test(name);

  return (
    <Box
      className="ekt-product-art"
      sx={{
        width: 86,
        height: 86,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        bgcolor: '#f5f7fa',
        borderRadius: '11px',
      }}
    >
      <svg width="80" height="80" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={isCable ? '#4e535c' : '#ffffff'} />
            <stop offset="1" stopColor={isCable ? '#171c25' : '#d9dee5'} />
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="83" rx="29" ry="5" fill="#dae0e8" opacity=".55" />
        {isCable ? (
          <>
            <ellipse
              cx="46"
              cy="51"
              rx="29"
              ry="25"
              fill="none"
              stroke="#202631"
              strokeWidth="14"
            />
            <ellipse
              cx="46"
              cy="47"
              rx="29"
              ry="25"
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth="13"
            />
            <ellipse
              cx="46"
              cy="46"
              rx="29"
              ry="25"
              fill="none"
              stroke="#68717d"
              strokeWidth="1.4"
              opacity=".55"
            />
            <ellipse
              cx="46"
              cy="50"
              rx="24"
              ry="20"
              fill="none"
              stroke="#747b84"
              strokeWidth=".8"
              opacity=".6"
            />
            <path
              d="M66 66c13-1 18-8 13-19L72 33"
              fill="none"
              stroke="#262d36"
              strokeWidth="9"
              strokeLinecap="round"
            />
            <path
              d="m72 34-3-12"
              fill="none"
              stroke="#4779ba"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="m76 32 1-12"
              fill="none"
              stroke="#a38556"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="m80 34 5-11"
              fill="none"
              stroke="#73a474"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="m69 22-1-4m9 2v-4m7 7 2-4"
              stroke="#cfa16a"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path d="m33 22 9 1-5 14-9-2zm13 40 10 1-2 14-10-1z" fill="#bdc6d3" opacity=".85" />
          </>
        ) : (
          <>
            <path d="m28 24 36-6 13 10v47L41 83 28 72z" fill="#c5ccd5" />
            <path d="m28 24 35 2v48l-35-2z" fill={`url(#${gradientId})`} stroke="#d0d6de" />
            <path d="m63 26 14 2v47l-14-1z" fill="#bec6d1" />
            <path d="m28 24 12-8 37 12-14-2z" fill="#e9ecf1" />
            <rect x="33" y="31" width="25" height="6" rx="1" fill="#f8fafc" />
            <path d="M36 34h12" stroke="#5a677b" strokeWidth="1.5" />
            <rect x="34" y="43" width="22" height="17" rx="2" fill="#384656" />
            <path d="m35 44 20 1-3 9-18-1z" fill="#3678b9" />
            <path d="m35 44 20 1v4l-21-1z" fill="#5093ce" />
            <path d="M35 66h12m-12 3h8" stroke="#8e99a9" strokeWidth="1.5" />
            <circle cx="44" cy="22" r="3" fill="#a1a9b6" />
            <path d="m42 21 4 2" stroke="#596474" />
            <circle cx="44" cy="76" r="3" fill="#a1a9b6" />
            <path d="m42 75 4 2" stroke="#596474" />
            <path
              d="m68 34 4 1m-4 5 4 1m-4 5 4 1m-4 5 4 1m-4 5 4 1m-4 5 4 1"
              stroke="#929eae"
              strokeWidth="1.5"
            />
          </>
        )}
      </svg>
    </Box>
  );
}
