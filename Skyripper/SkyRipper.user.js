// ==UserScript==
// @name						 SkyRipper
// @description      Data ripper for skypilot-based shopify stores.
// @match            *
// @version          1.0
// @require https://code.jquery.com/jquery-3.7.0.js
// @grant GM_xmlhttpRequest
// @grant GM_fetch
// @grant GM_download
// @grant GM_registerMenuCommand
// ==/UserScript==

$(function () {
  GM_registerMenuCommand("Save all purchased content links on page to file.", () => findAllPageContents());
});

async function findAllPageContents() {
  console.log("Function called")
  let files = $('.sky-pilot-files-list>a').map((i, el) => el.getAttribute('href')).get();
  let video_ids = $('.sky-pilot-video-list>a>.sky-pilot-video-item>img').map((i, el) => el.getAttribute('data-video-url').split('/').at(-1)).get();
  let video_titles = $('.sky-pilot-video-list>a>div>.sky-pilot-video-title').map((i, el) => el.textContent.trim()).get();

  let vimeo_app_id = new URLSearchParams($('.sky-pilot-embed>iframe').attr('src')).get("app_id");
  let vimeo_player_url = "https://player.vimeo.com/video/";

  let referrer = window.location.origin;

  let file_URLs = [];

  for (let file of files) {
    try {
    	let res = await getDownloadURL(file);
      file_URLs.push(res);
      console.log(res);
    } catch { continue; }
  }

  let videos = [];
  for (let i in video_ids) {
    // first, we build up the URL (id, app_id, etc)
    let vid_url = `${vimeo_player_url}${video_ids[i]}?app_id=${vimeo_app_id}`;

    // then, we get the URL (build request, analyze returned player page, extract URL)
    let distribution_url = await getVimeoURL(vid_url, referrer);
    console.log("vid_url", vid_url);
    console.log("distribution_url / .m3u8", distribution_url);
    videos.push({url: distribution_url, name: video_titles[i]});
  }

  console.log(videos);

  // videos to a .ps1 / .sh file with pre-baked download commands..
  let target_folder_name = $(".sky-pilot-heading")[0].innerHTML;
  target_folder_name.replace('"', '\"');

  let file_contents = [];
  file_contents.push(`$Downloader_Executable = "./yt-dlp.exe"`);
  file_contents.push(`$FolderName = \"${target_folder_name}\"`);
  file_contents.push(`$FolderName -replace "[$([Regex]::Escape([System.IO.Path]::GetInvalidFileNameChars()) -join '')]", "_"`); // sanitize

  // create folder
  file_contents.push(`if (-not(Test-Path $FolderName)) { New-Item $FolderName -ItemType Directory -Force } # Get-ChildItem $FolderName | Remove-Item`);

  // file downloads
  for (let file of file_URLs) {
  	file_contents.push(`wget "${file.url}" -outfile "$FolderName/${file.name}"`);
  }

  let video_array = [];
  // Video
  for (let vid of videos) {
    video_array.push(`@('-o', """$FolderName/${vid.name}""", '"${vid.url}"', '--restrict-filenames')`);
  }

  file_contents.push(`$Videos = @(${video_array.join(", ")})`);

	// Run all video commands:
  file_contents.push(`ForEach($video in $Videos) { & $Downloader_Executable $video }`);


  let file_url = URL.createObjectURL(new Blob([file_contents.join("\n")]));

  // Create a download link
  const downloadLink = document.createElement('a');
  downloadLink.href = file_url;
  downloadLink.download = `${target_folder_name}.ps1`;

  // Trigger the download
  document.body.appendChild(downloadLink);
  downloadLink.click();

  // Clean up
  setTimeout(() => {
    URL.revokeObjectURL(downloadLink.href);
    document.body.removeChild(downloadLink);
  }, 100);
}

async function getDownloadURL(url) {
  return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        url: url,
        onload: async (response) => {
          let filename = decodeURI((new URL(response.finalUrl)).pathname.split('/').at(-1));
          if (response.status !== 200) {
            let msg = `Unable to download file. HTTP status: ${response.status}, text: ${response.statusText}, file name: ${filename}`;
      			console.error(msg);
      			reject(msg);
          }
          resolve({url: response.finalUrl, name: filename});
        }});
  });
}

async function getVimeoURL(url, ref) {
  return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        url: url, headers: {referer: ref},
        onload: async (response) => {
          if (response.status !== 200) {
            let msg = `Unable to download file. HTTP status: ${response.status}, text: ${response.statusText}`;
      			console.error(msg);
      			reject(msg);
          }
          // now, we fetch the real URL from the response body
          let doc = new DOMParser().parseFromString(response.response, "text/html");
          for (let x of doc.body.getElementsByTagName("Script")) {
            if (x.innerHTML.includes("window.playerConfig = {")) {
              let playerConfig = JSON.parse(`${x.innerHTML.slice(22, -1)}}`);
//               console.log(playerConfig.request.files)
          		resolve(playerConfig.request.files.hls.cdns[playerConfig.request.files.hls.default_cdn].url); // this returs a .m3u8 files which can be used to download the video.
            }
          }
        }});
  });
}