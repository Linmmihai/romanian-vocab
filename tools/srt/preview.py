import os
import re
import textwrap #cd /Users/miko/Documents/srt_edit/tools/content_original/srt
                #python3 line.py


MAX_CHARS = 45
INPUT_FOLDER = "."
OUTPUT_FOLDER = "output_srt"


def parse_time(time_str):
    """
    00:00:01,000 -> 毫秒
    """
    h, m, s = time_str.strip().split(":")
    s, ms = s.split(",")
    return (int(h) * 3600 + int(m) * 60 + int(s)) * 1000 + int(ms)


def format_time(ms):
    """
    毫秒 -> 00:00:01,000
    """
    h = ms // 3600000
    ms %= 3600000

    m = ms // 60000
    ms %= 60000

    s = ms // 1000
    ms %= 1000

    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def clean_punctuation(text):
    """
    基础标点和空格整理。
    不在这里处理大小写。
    """
    text = text.strip()

    # 多个空格变成一个
    text = re.sub(r"\s+", " ", text)

    # 删除标点前多余空格
    text = re.sub(r"\s+([,.!?;:])", r"\1", text)

    # 标点后补空格
    text = re.sub(r"([,.!?;:])([^\s])", r"\1 \2", text)

    # 修复重复标点
    text = re.sub(r"\.{2,}", ".", text)
    text = re.sub(r",{2,}", ",", text)
    text = re.sub(r"!{2,}", "!", text)
    text = re.sub(r"\?{2,}", "?", text)

    return text.strip()


def normalize_text(text):
    """
    文本清洗：只处理空格和标点，不直接修改大小写。
    """
    return clean_punctuation(text)


def uppercase_first_letter(text):
    """
    只把第一个字母改成大写。
    会跳过开头的引号、括号、破折号等符号。
    """
    chars = list(text)

    for i, ch in enumerate(chars):
        if ch.isalpha():
            chars[i] = ch.upper()
            break

    return "".join(chars)


def lowercase_first_letter(text):
    """
    只把第一个字母改成小写。
    会跳过开头的引号、括号、破折号等符号。
    """
    chars = list(text)

    for i, ch in enumerate(chars):
        if ch.isalpha():
            chars[i] = ch.lower()
            break

    return "".join(chars)


def ends_with_sentence_punctuation(text):
    """
    判断文本是否以句号、感叹号、问号结尾。
    会忽略末尾的引号、括号等符号。
    """
    text = text.strip()

    if not text:
        return False

    # 去掉末尾常见闭合符号
    text = re.sub(r"[\"'”’)\]\}]+$", "", text).strip()

    return text.endswith((".", "!", "?"))


def fix_case_by_previous_text(current_text, previous_text):
    """
    根据上一条字幕的结尾判断当前字幕首字母大小写。

    规则：
    1. 没有上一条字幕：保持原样
    2. 上一条以 . ! ? 结尾：当前首字母大写
    3. 上一条没有以 . ! ? 结尾：当前首字母小写
    """
    if not previous_text:
        return current_text

    if ends_with_sentence_punctuation(previous_text):
        return uppercase_first_letter(current_text)
    else:
        return lowercase_first_letter(current_text)


def split_long_line(line, max_chars=45):
    """
    如果单行超过 max_chars，则按词拆分。
    不强行切断单词。
    """
    line = line.strip()

    if len(line) <= max_chars:
        return [line]

    parts = textwrap.wrap(
        line,
        width=max_chars,
        break_long_words=False,
        break_on_hyphens=False
    )

    return parts


def split_text_to_parts(text_lines, max_chars=45):
    """
    处理字幕文本：
    1. 原本多行 -> 拆成多个部分
    2. 每一行超过 max_chars -> 继续拆分
    3. 做标点和空格修正
    4. 这里只负责拆分，不负责上下文大小写
    """
    parts = []

    for line in text_lines:
        line = line.strip()

        if not line:
            continue

        fixed_line = normalize_text(line)
        split_lines = split_long_line(fixed_line, max_chars=max_chars)

        for item in split_lines:
            item = normalize_text(item)
            if item:
                parts.append(item)

    return parts


def split_time_by_text_length(start_ms, end_ms, parts):
    """
    按字幕文本长度分配时间。
    比平均分配更自然。
    """
    duration = end_ms - start_ms

    if duration <= 0:
        return []

    total_length = sum(len(p) for p in parts)

    if total_length == 0:
        return []

    result = []
    current_start = start_ms

    for i, part in enumerate(parts):
        if i == len(parts) - 1:
            current_end = end_ms
        else:
            ratio = len(part) / total_length
            part_duration = int(duration * ratio)

            # 最低时长，避免字幕太快闪过
            part_duration = max(part_duration, 500)

            current_end = current_start + part_duration

            if current_end > end_ms:
                current_end = end_ms

        result.append((current_start, current_end, part))
        current_start = current_end

    return result


def process_srt(input_file, output_file, max_chars=45):
    with open(input_file, "r", encoding="utf-8-sig") as f:
        content = f.read()

    # 兼容 Windows / Mac / Linux 换行
    content = content.replace("\r\n", "\n").replace("\r", "\n")

    blocks = re.split(r"\n\s*\n", content.strip())

    new_blocks = []
    new_index = 1

    # 这个变量用于处理“不同字幕块之间”的大小写
    previous_text = ""

    for block in blocks:
        lines = block.strip().split("\n")

        if len(lines) < 3:
            continue

        time_line = lines[1].strip()

        if " --> " not in time_line:
            continue

        try:
            start, end = time_line.split(" --> ")
            start_ms = parse_time(start)
            end_ms = parse_time(end)
        except Exception:
            print(f"时间轴格式异常，已跳过：{input_file}")
            continue

        text_lines = lines[2:]

        # 先拆分文本
        parts = split_text_to_parts(text_lines, max_chars=max_chars)

        if not parts:
            continue

        # 再根据上下文修正大小写
        fixed_parts = []

        for part in parts:
            part = fix_case_by_previous_text(part, previous_text)
            fixed_parts.append(part)

            # 更新上一条字幕文本
            previous_text = part

        # 分配时间
        timed_parts = split_time_by_text_length(start_ms, end_ms, fixed_parts)

        for part_start_ms, part_end_ms, text in timed_parts:
            new_blocks.append(
                f"{new_index}\n"
                f"{format_time(part_start_ms)} --> {format_time(part_end_ms)}\n"
                f"{text}"
            )
            new_index += 1

    with open(output_file, "w", encoding="utf-8") as f:
        f.write("\n\n".join(new_blocks) + "\n")


def main():
    os.makedirs(OUTPUT_FOLDER, exist_ok=True)

    count = 0

    for filename in os.listdir(INPUT_FOLDER):
        if filename.lower().endswith(".srt"):
            count += 1

            input_path = os.path.join(INPUT_FOLDER, filename)
            output_path = os.path.join(OUTPUT_FOLDER, filename)

            try:
                process_srt(input_path, output_path, max_chars=MAX_CHARS)
                print(f"处理成功：{filename}")
            except Exception as e:
                print(f"处理失败：{filename}")
                print(e)

    print(f"全部完成，共处理 {count} 个 srt 文件")
    print(f"输出目录：{OUTPUT_FOLDER}")


if __name__ == "__main__":
    main()